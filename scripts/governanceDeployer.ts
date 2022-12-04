import { Address, L1ToL2MessageStatus, L1TransactionReceipt } from "@arbitrum/sdk";
import { Inbox__factory } from "@arbitrum/sdk/dist/lib/abi/factories/Inbox__factory";
import { L1CustomGateway__factory } from "@arbitrum/sdk/dist/lib/abi/factories/L1CustomGateway__factory";
import { L2CustomGateway__factory } from "@arbitrum/sdk/dist/lib/abi/factories/L2CustomGateway__factory";
import { L2GatewayRouter__factory } from "@arbitrum/sdk/dist/lib/abi/factories/L2GatewayRouter__factory";
import { BigNumber, ethers, Signer } from "ethers";
import { parseEther } from "ethers/lib/utils";
import {
  ArbitrumTimelock,
  ArbitrumTimelock__factory,
  FixedDelegateErc20Wallet,
  FixedDelegateErc20Wallet__factory,
  L1ArbitrumToken,
  L1ArbitrumToken__factory,
  L1GovernanceFactory__factory,
  L2ArbitrumGovernor,
  L2ArbitrumGovernor__factory,
  L2ArbitrumToken,
  L2ArbitrumToken__factory,
  L2GovernanceFactory__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  TokenDistributor,
  TokenDistributor__factory,
  TransparentUpgradeableProxy,
  TransparentUpgradeableProxy__factory,
  UpgradeExecutor,
  UpgradeExecutor__factory,
} from "../typechain-types";
import { L2CustomGatewayToken__factory } from "../typechain-types-imported/index";
import {
  DeployedEventObject as L1DeployedEventObject,
  L1GovernanceFactory,
} from "../typechain-types/src/L1GovernanceFactory";
import {
  DeployedEventObject as L2DeployedEventObject,
  L2GovernanceFactory,
} from "../typechain-types/src/L2GovernanceFactory";
import * as GovernanceConstants from "./governance.constants";
import { getDeployers } from "./providerSetup";

// store address for every deployed contract
let deployedContracts: { [key: string]: string } = {};
const DEPLOYED_CONTRACTS_FILE_NAME = "deployedContracts.json";
const TOKEN_RECIPIENTS_FILE_NAME = "files/recipients.json";

/**
 * Performs each step of the Arbitrum governance deployment process.
 *
 * /// @notice Governance Deployment Steps:
 * /// 1. Deploy the following pre-requiste logic contracts:
 * ///     L1:
 * ///         - UpgradeExecutor logic
 * ///     L2:
 * ///         - ArbitrumTimelock logic
 * ///         - L2ArbitrumGovernor logic
 * ///         - FixedDelegateErc20 logic
 * ///         - L2ArbitrumToken logic
 * ///         - UpgradeExecutor logic
 * /// 2. Then deploy the following (in any order):
 * ///     L1:
 * ///         - L1GoveranceFactory
 * ///         - L1Token
 * ///         - Gnosis Safe Multisig 9 of 12 Security Council
 * ///     L2:
 * ///         - L2GovernanceFactory
 * ///         - Gnosis Safe Multisig 9 of 12 Security Council
 * ///         - Gnosis Safe Multisig 7 of 12 Security Council
 * ///
 * ///     L1GoveranceFactory and L2GovernanceFactory deployers will be their respective owners, and will carry out the following steps.
 * /// 3. Call L2GovernanceFactory.deployStep1
 * ///     - Dependencies: L1-Token address, 7 of 12 multisig (as _upgradeProposer)
 * ///
 * /// 4. Call L1GoveranceFactory.deployStep2
 * ///     - Dependencies: L1 security council address, L2 Timelock address (deployed in previous step)
 * ///
 * /// 5. Call L2GovernanceFactory.deployStep3
 * ///     - Dependencies: (Aliased) L1-timelock address (deployed in previous step), L2 security council address (as _l2UpgradeExecutors)
 * /// 6. From the _l2InitialSupplyRecipient transfer ownership of the L2ArbitrumToken to the UpgradeExecutor
 * ///    Then transfer tokens from _l2InitialSupplyRecipient to the treasury and other token distributor
 * @returns
 */
export const deployGovernance = async () => {
  console.log("Get deployers and signers");
  const { ethDeployer, arbDeployer, novaDeployer } = await getDeployers();

  console.log("Deploy L1 logic contracts");
  const l1UpgradeExecutorLogic = await deployL1LogicContracts(ethDeployer);

  console.log("Deploy L2 logic contracts");
  const { timelockLogic, governorLogic, fixedDelegateLogic, l2TokenLogic, upgradeExecutor } =
    await deployL2LogicContracts(arbDeployer);

  console.log("Deploy L1 governance factory");
  const l1GovernanceFactory = await deployL1GovernanceFactory(ethDeployer);

  console.log("Deploy and init L1 Arbitrum token");
  const { l1Token, l1TokenProxy } = await deployAndInitL1Token(ethDeployer);

  console.log("Deploy L2 governance factory");
  const l2GovernanceFactory = await deployL2GovernanceFactory(
    arbDeployer,
    timelockLogic,
    governorLogic,
    fixedDelegateLogic,
    l2TokenLogic,
    upgradeExecutor
  );

  console.log("Deploy UpgradeExecutor to Nova");
  const { novaProxyAdmin, novaUpgradeExecutorProxy } = await deployNovaUpgradeExecutor(
    novaDeployer
  );

  console.log("Deploy token to Nova");
  const novaToken = await deployTokenToNova(novaDeployer, novaProxyAdmin, l1Token);

  // step 1
  console.log("Init L2 governance");
  const l2DeployResult = await initL2Governance(arbDeployer, l2GovernanceFactory, l1Token.address);

  // step 2
  console.log("Init L1 governance");
  const l1DeployResult = await initL1Governance(
    l1GovernanceFactory,
    l1UpgradeExecutorLogic,
    l2DeployResult
  );

  // step 3
  console.log("Set executor roles");
  await setExecutorRoles(
    l1DeployResult,
    l2GovernanceFactory,
    novaUpgradeExecutorProxy,
    novaProxyAdmin,
    novaDeployer
  );

  console.log("Post deployment L1 token tasks");
  await postDeploymentL1TokenTasks(
    ethDeployer,
    l1TokenProxy,
    l1DeployResult.proxyAdmin,
    novaToken.address,
    novaDeployer
  );

  console.log("Post deployment L2 token tasks");
  await postDeploymentL2TokenTasks(arbDeployer, l2DeployResult);

  // deploy ARB distributor
  console.log("Deploy TokenDistributor");
  await deployAndInitTokenDistributor(arbDeployer, l2DeployResult, arbDeployer);

  console.log("Write deployed contract addresses to deployedContracts.json");
  writeAddresses();
};

async function deployL1LogicContracts(ethDeployer: Signer) {
  const l1UpgradeExecutorLogic = await new UpgradeExecutor__factory(ethDeployer).deploy();

  // store address
  deployedContracts["l1UpgradeExecutorLogic"] = l1UpgradeExecutorLogic.address;

  return l1UpgradeExecutorLogic;
}

async function deployL2LogicContracts(arbDeployer: Signer) {
  const timelockLogic = await new ArbitrumTimelock__factory(arbDeployer).deploy();
  const governorLogic = await new L2ArbitrumGovernor__factory(arbDeployer).deploy();
  const fixedDelegateLogic = await new FixedDelegateErc20Wallet__factory(arbDeployer).deploy();
  const l2TokenLogic = await new L2ArbitrumToken__factory(arbDeployer).deploy();
  const upgradeExecutor = await new UpgradeExecutor__factory(arbDeployer).deploy();

  // store addresses
  deployedContracts["l2TimelockLogic"] = timelockLogic.address;
  deployedContracts["l2GovernorLogic"] = governorLogic.address;
  deployedContracts["l2FixedDelegateLogic"] = fixedDelegateLogic.address;
  deployedContracts["l2TokenLogic"] = l2TokenLogic.address;
  deployedContracts["l2UpgradeExecutorLogic"] = upgradeExecutor.address;

  return { timelockLogic, governorLogic, fixedDelegateLogic, l2TokenLogic, upgradeExecutor };
}

async function deployL1GovernanceFactory(ethDeployer: Signer) {
  const l1GovernanceFactory = await new L1GovernanceFactory__factory(ethDeployer).deploy();
  await l1GovernanceFactory.deployed();

  // store address
  deployedContracts["l1GovernanceFactory"] = l1GovernanceFactory.address;

  return l1GovernanceFactory;
}

async function deployAndInitL1Token(ethDeployer: Signer) {
  // deploy logic
  const l1TokenLogic = await new L1ArbitrumToken__factory(ethDeployer).deploy();

  // deploy proxy
  const l1TokenProxy = await new TransparentUpgradeableProxy__factory(ethDeployer).deploy(
    l1TokenLogic.address,
    ethDeployer.getAddress(),
    "0x",
    { gasLimit: 3000000 }
  );
  await l1TokenProxy.deployed();

  const l1Token = L1ArbitrumToken__factory.connect(l1TokenProxy.address, ethDeployer);

  // store addresses
  deployedContracts["l1TokenLogic"] = l1TokenLogic.address;
  deployedContracts["l1TokenProxy"] = l1TokenProxy.address;

  return { l1Token, l1TokenProxy };
}

async function deployL2GovernanceFactory(
  arbDeployer: Signer,
  timelockLogic: ArbitrumTimelock,
  governorLogic: L2ArbitrumGovernor,
  fixedDelegateLogic: FixedDelegateErc20Wallet,
  l2TokenLogic: L2ArbitrumToken,
  upgradeExecutor: UpgradeExecutor
) {
  const l2GovernanceFactory = await new L2GovernanceFactory__factory(arbDeployer).deploy(
    timelockLogic.address,
    governorLogic.address,
    timelockLogic.address,
    fixedDelegateLogic.address,
    governorLogic.address,
    l2TokenLogic.address,
    upgradeExecutor.address
  );

  // store address
  deployedContracts["l2GovernanceFactory"] = l2GovernanceFactory.address;

  return l2GovernanceFactory;
}

async function deployNovaUpgradeExecutor(novaDeployer: Signer) {
  // deploy proxy admin
  const novaProxyAdmin = await new ProxyAdmin__factory(novaDeployer).deploy();
  await novaProxyAdmin.deployed();

  // deploy logic
  const novaUpgradeExecutorLogic = await new UpgradeExecutor__factory(novaDeployer).deploy();

  // deploy proxy with proxyAdmin as owner
  const novaUpgradeExecutorProxy = await new TransparentUpgradeableProxy__factory(
    novaDeployer
  ).deploy(novaUpgradeExecutorLogic.address, novaProxyAdmin.address, "0x");
  await novaUpgradeExecutorProxy.deployed();

  // store addresses
  deployedContracts["novaProxyAdmin"] = novaProxyAdmin.address;
  deployedContracts["novaUpgradeExecutorLogic"] = novaUpgradeExecutorLogic.address;
  deployedContracts["novaUpgradeExecutorProxy"] = novaUpgradeExecutorProxy.address;

  return { novaProxyAdmin, novaUpgradeExecutorProxy };
}

async function deployTokenToNova(
  novaDeployer: Signer,
  proxyAdmin: ProxyAdmin,
  l1Token: L1ArbitrumToken
) {
  // deploy token logic
  const novaTokenLogic = await new L2CustomGatewayToken__factory(novaDeployer).deploy();

  // deploy token proxy
  const novaTokenProxy = await new TransparentUpgradeableProxy__factory(novaDeployer).deploy(
    novaTokenLogic.address,
    proxyAdmin.address,
    "0x"
  );
  await novaTokenProxy.deployed();

  // init
  const novaToken = L2CustomGatewayToken__factory.connect(novaTokenProxy.address, novaDeployer);
  await novaToken.initialize(
    GovernanceConstants.NOVA_TOKEN_NAME,
    GovernanceConstants.NOVA_TOKEN_SYMBOL,
    GovernanceConstants.NOVA_TOKEN_DECIMALS,
    GovernanceConstants.NOVA_TOKEN_GATEWAY,
    l1Token.address
  );

  // store addresses
  deployedContracts["novaTokenLogic"] = novaTokenLogic.address;
  deployedContracts["novaTokenProxy"] = novaTokenProxy.address;

  return novaToken;
}

async function initL2Governance(
  arbDeployer: Signer,
  l2GovernanceFactory: L2GovernanceFactory,
  l1TokenAddress: string
) {
  const arbInitialSupplyRecipientAddr = await arbDeployer.getAddress();

  // deploy
  const l2GovDeployReceipt = await (
    await l2GovernanceFactory.deployStep1({
      _l2MinTimelockDelay: GovernanceConstants.L2_TIMELOCK_DELAY,
      _l2TokenInitialSupply: parseEther(GovernanceConstants.L2_TOKEN_INITIAL_SUPPLY),
      _upgradeProposer: GovernanceConstants.L2_7_OF_12_SECURITY_COUNCIL,
      _coreQuorumThreshold: GovernanceConstants.L2_CORE_QUORUM_TRESHOLD,
      _l1Token: l1TokenAddress,
      _treasuryQuorumThreshold: GovernanceConstants.L2_TREASURY_QUORUM_TRESHOLD,
      _proposalThreshold: GovernanceConstants.L2_PROPOSAL_TRESHOLD,
      _votingDelay: GovernanceConstants.L2_VOTING_DELAY,
      _votingPeriod: GovernanceConstants.L2_VOTING_PERIOD,
      _minPeriodAfterQuorum: GovernanceConstants.L2_MIN_PERIOD_AFTER_QUORUM,
      _l2InitialSupplyRecipient: arbInitialSupplyRecipientAddr,
      _l2EmergencySecurityCouncil: GovernanceConstants.L2_9_OF_12_SECURITY_COUNCIL,
    })
  ).wait();

  // get deployed contract addresses
  const l2DeployResult = l2GovDeployReceipt.events?.filter(
    (e) => e.topics[0] === l2GovernanceFactory.interface.getEventTopic("Deployed")
  )[0].args as unknown as L2DeployedEventObject;

  // store addresses
  deployedContracts["l2CoreGoverner"] = l2DeployResult.coreGoverner;
  deployedContracts["l2CoreTimelock"] = l2DeployResult.coreTimelock;
  deployedContracts["l2Executor"] = l2DeployResult.executor;
  deployedContracts["l2ProxyAdmin"] = l2DeployResult.proxyAdmin;
  deployedContracts["l2Token"] = l2DeployResult.token;
  deployedContracts["l2TreasuryGoverner"] = l2DeployResult.treasuryGoverner;
  deployedContracts["l2ArbTreasury"] = l2DeployResult.arbTreasury;

  return l2DeployResult;
}

async function initL1Governance(
  l1GovernanceFactory: L1GovernanceFactory,
  l1UpgradeExecutorLogic: UpgradeExecutor,
  l2DeployResult: L2DeployedEventObject
) {
  // deploy
  const l1GovDeployReceipt = await (
    await l1GovernanceFactory.deployStep2(
      l1UpgradeExecutorLogic.address,
      GovernanceConstants.L1_TIMELOCK_DELAY,
      GovernanceConstants.L1_ARB_INBOX,
      l2DeployResult.coreTimelock,
      GovernanceConstants.L1_9_OF_12_SECURITY_COUNCIL
    )
  ).wait();

  // get deployed contract addresses
  const l1DeployResult = l1GovDeployReceipt.events?.filter(
    (e) => e.topics[0] === l1GovernanceFactory.interface.getEventTopic("Deployed")
  )[0].args as unknown as L1DeployedEventObject;

  // store contract addresses
  deployedContracts["l1Executor"] = l1DeployResult.executor;
  deployedContracts["l1ProxyAdmin"] = l1DeployResult.proxyAdmin;
  deployedContracts["l1Timelock"] = l1DeployResult.timelock;

  return l1DeployResult;
}

async function setExecutorRoles(
  l1DeployResult: L1DeployedEventObject,
  l2GovernanceFactory: L2GovernanceFactory,
  novaUpgradeExecutorProxy: TransparentUpgradeableProxy,
  novaProxyAdmin: ProxyAdmin,
  novaDeployer: Signer
) {
  const l1TimelockAddress = new Address(l1DeployResult.timelock);
  const l1TimelockAliased = l1TimelockAddress.applyAlias().value;

  // set executors on L2
  await l2GovernanceFactory.deployStep3(l1TimelockAliased);

  // set executors on Nova
  const novaUpgradeExecutor = UpgradeExecutor__factory.connect(
    novaUpgradeExecutorProxy.address,
    novaDeployer
  );
  await novaUpgradeExecutor.initialize(novaUpgradeExecutor.address, [
    l1TimelockAliased,
    GovernanceConstants.NOVA_9_OF_12_SECURITY_COUNCIL,
  ]);

  // transfer ownership over novaProxyAdmin to executor
  await novaProxyAdmin.transferOwnership(novaUpgradeExecutor.address);
}

async function postDeploymentL1TokenTasks(
  ethDeployer: Signer,
  l1TokenProxy: TransparentUpgradeableProxy,
  l1ProxyAdminAddress: string,
  novaTokenAddress: string,
  novaDeployer: Signer
) {
  // set L1 proxy admin as L1 token's admin
  await (await l1TokenProxy.changeAdmin(l1ProxyAdminAddress)).wait();

  // init L1 token
  const l1Token = L1ArbitrumToken__factory.connect(l1TokenProxy.address, ethDeployer);
  await (
    await l1Token.initialize(
      GovernanceConstants.L1_ARB_GATEWAY,
      GovernanceConstants.L1_NOVA_ROUTER,
      GovernanceConstants.L1_NOVA_GATEWAY
    )
  ).wait();

  //// register token on L2

  // 1 million gas limit
  const maxGas = BigNumber.from(1000000);
  const novaGasPrice = (await novaDeployer.provider!.getGasPrice()).mul(2);

  const novaGateway = L1CustomGateway__factory.connect(await l1Token.novaGateway(), ethDeployer);
  const novaInbox = Inbox__factory.connect(await novaGateway.inbox(), ethDeployer);

  // calcs for novaGateway
  const novaGatewayRegistrationData = L2CustomGateway__factory.createInterface().encodeFunctionData(
    "registerTokenFromL1",
    [[l1Token.address], [novaTokenAddress]]
  );
  const novaGatewaySubmissionFee = (
    await novaInbox.callStatic.calculateRetryableSubmissionFee(
      ethers.utils.hexDataLength(novaGatewayRegistrationData),
      0
    )
  ).mul(2);
  const valueForNovaGateway = novaGatewaySubmissionFee.add(maxGas.mul(novaGasPrice));

  // calcs for novaRouter
  const novaRouterRegistrationData = L2GatewayRouter__factory.createInterface().encodeFunctionData(
    "setGateway",
    [[l1Token.address], [novaGateway.address]]
  );
  const novaRouterSubmissionFee = (
    await novaInbox.callStatic.calculateRetryableSubmissionFee(
      ethers.utils.hexDataLength(novaRouterRegistrationData),
      0
    )
  ).mul(2);
  const valueForNovaRouter = novaRouterSubmissionFee.add(maxGas.mul(novaGasPrice));

  // do the registration
  const extra = 1000;
  const l1RegistrationTx = await l1Token.registerTokenOnL2(
    {
      l2TokenAddress: novaTokenAddress,
      maxSubmissionCostForCustomGateway: novaGatewaySubmissionFee,
      maxSubmissionCostForRouter: novaRouterSubmissionFee,
      maxGasForCustomGateway: maxGas,
      maxGasForRouter: maxGas,
      gasPriceBid: novaGasPrice,
      valueForGateway: valueForNovaGateway,
      valueForRouter: valueForNovaRouter,
      creditBackAddress: await ethDeployer.getAddress(),
    },
    {
      value: valueForNovaGateway.add(valueForNovaRouter).add(extra),
      gasLimit: 3000000,
    }
  );

  //// wait for L2 TXs

  const l1RegistrationTxReceipt = await L1TransactionReceipt.monkeyPatchWait(
    l1RegistrationTx
  ).wait();
  const l1ToL2Msgs = await l1RegistrationTxReceipt.getL1ToL2Messages(novaDeployer.provider!);

  // status should be REDEEMED
  const setTokenTx = await l1ToL2Msgs[0].waitForStatus();
  const setGatewaysTX = await l1ToL2Msgs[1].waitForStatus();
  if (setTokenTx.status != L1ToL2MessageStatus.REDEEMED) {
    throw new Error(
      "Register token L1 to L2 message not redeemed. Status: " + setTokenTx.status.toString()
    );
  }
  if (setGatewaysTX.status != L1ToL2MessageStatus.REDEEMED) {
    throw new Error(
      "Set gateway L1 to L2 message not redeemed. Status: " + setGatewaysTX.status.toString()
    );
  }
}

async function postDeploymentL2TokenTasks(
  arbInitialSupplyRecipient: Signer,
  l2DeployResult: L2DeployedEventObject
) {
  // transfer L2 token ownership to upgradeExecutor
  const l2Token = L2ArbitrumToken__factory.connect(
    l2DeployResult.token,
    arbInitialSupplyRecipient.provider!
  );
  await l2Token.connect(arbInitialSupplyRecipient).transferOwnership(l2DeployResult.executor);

  // transfer tokens from arbDeployer to the treasury
  await l2Token
    .connect(arbInitialSupplyRecipient)
    .transfer(
      l2DeployResult.arbTreasury,
      parseEther(GovernanceConstants.L2_NUM_OF_TOKENS_FOR_TREASURY)
    );

  /// when distributor is deployed remaining tokens are transfered to it
}

async function deployAndInitTokenDistributor(
  arbDeployer: Signer,
  l2DeployResult: L2DeployedEventObject,
  arbInitialSupplyRecipient: Signer
) {
  // deploy TokenDistributor
  const tokenDistributor = await new TokenDistributor__factory(arbDeployer).deploy(
    l2DeployResult.token,
    GovernanceConstants.L2_SWEEP_RECECIVER,
    await arbDeployer.getAddress(),
    GovernanceConstants.L2_CLAIM_PERIOD_START,
    GovernanceConstants.L2_CLAIM_PERIOD_END
  );
  await tokenDistributor.deployed();

  // store address
  deployedContracts["l2TokenDistributor"] = tokenDistributor.address;

  // transfer tokens from arbDeployer to the distributor
  const l2Token = L2ArbitrumToken__factory.connect(
    l2DeployResult.token,
    arbInitialSupplyRecipient.provider!
  );
  await (
    await l2Token
      .connect(arbInitialSupplyRecipient)
      .transfer(
        tokenDistributor.address,
        parseEther(GovernanceConstants.L2_NUM_OF_TOKENS_FOR_CLAIMING)
      )
  ).wait();

  // set claim recipients
  await setClaimRecipients(tokenDistributor, arbDeployer);

  // transfer ownership to L2 UpgradeExecutor
  await (await tokenDistributor.transferOwnership(l2DeployResult.executor)).wait();
}

/**
 * Sets airdrop recipients in batches. Batch is posted every 1sec, but if gas price gets
 * above 0.12 gwei we wait until it falls back to base gas price of 0.1 gwei.
 *
 * @param tokenDistributor
 * @param arbDeployer
 */
async function setClaimRecipients(tokenDistributor: TokenDistributor, arbDeployer: Signer) {
  const tokenRecipientsByPoints = require("../" + TOKEN_RECIPIENTS_FILE_NAME);
  const { tokenRecipients, tokenAmounts } = mapPointsToAmounts(tokenRecipientsByPoints);

  // set recipients in batches
  const BATCH_SIZE = 100;
  const numOfBatches = Math.floor(tokenRecipients.length / BATCH_SIZE);

  // 0.12 gwei
  const GAS_PRICE_UNACCEPTABLE_LIMIT = BigNumber.from(120000000);
  // 0.1 gwei
  const BASE_GAS_PRICE = BigNumber.from(100000000);

  for (
    let i = GovernanceConstants.L2_NUM_OF_RECIPIENT_BATCHES_ALREADY_SET;
    i <= numOfBatches;
    i++
  ) {
    console.log("---- Batch ", i, "/", numOfBatches);

    let gasPriceBestGuess = await arbDeployer.provider!.getGasPrice();

    // if gas price is >0.12 gwei wait until if falls to 0.1 gwei
    if (gasPriceBestGuess.gt(GAS_PRICE_UNACCEPTABLE_LIMIT)) {
      while (true) {
        console.log(
          "Gas price too high: ",
          ethers.utils.formatUnits(gasPriceBestGuess, "gwei"),
          " gwei"
        );
        console.log("Sleeping 30 sec");
        // sleep 30 sec, then check if gas price has fallen down
        await new Promise((resolve) => setTimeout(resolve, 30000));

        // check if fell back to 0.1 gwei
        gasPriceBestGuess = await arbDeployer.provider!.getGasPrice();
        if (gasPriceBestGuess.eq(BASE_GAS_PRICE)) {
          break;
        }
      }
    }

    // generally sleep 1 second to keep TX fees from going up
    await new Promise((resolve) => setTimeout(resolve, 1000));

    let recipientsBatch: string[] = [];
    let amountsBatch: BigNumber[] = [];

    // slice batches
    if (i < numOfBatches) {
      recipientsBatch = tokenRecipients.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
      amountsBatch = tokenAmounts.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    } else {
      if (tokenRecipients.length == numOfBatches * BATCH_SIZE) {
        // nothing left
        break;
      }
      // last remaining batch
      recipientsBatch = tokenRecipients.slice(i * BATCH_SIZE);
      amountsBatch = tokenAmounts.slice(i * BATCH_SIZE);
    }

    // set recipients
    const txReceipt = await (
      await tokenDistributor.setRecipients(recipientsBatch, amountsBatch, { gasLimit: 30000000 })
    ).wait();

    // print gas usage stats
    console.log("Gas used: ", txReceipt.gasUsed.toString());
    console.log(
      "Gas price in gwei: ",
      ethers.utils.formatUnits(txReceipt.effectiveGasPrice, "gwei")
    );
    console.log(
      "Gas cost in ETH: ",
      ethers.utils.formatUnits(txReceipt.gasUsed.mul(txReceipt.effectiveGasPrice), "ether")
    );
  }
}

/**
 * Map points to claimable token amount per account
 * @param tokenRecipientsByPoints
 */
function mapPointsToAmounts(tokenRecipientsByPoints: any) {
  let tokenRecipients: string[] = [];
  let tokenAmounts: BigNumber[] = [];

  for (const key in tokenRecipientsByPoints) {
    tokenRecipients.push(key);

    const points = tokenRecipientsByPoints[key].points;
    switch (points) {
      case 3: {
        tokenAmounts.push(parseEther("3000"));
        break;
      }
      case 4: {
        tokenAmounts.push(parseEther("4500"));
        break;
      }
      case 5: {
        tokenAmounts.push(parseEther("6000"));
        break;
      }
      case 6: {
        tokenAmounts.push(parseEther("9000"));
        break;
      }
      case 7: {
        tokenAmounts.push(parseEther("10500"));
        break;
      }
      case 8:
      case 9:
      case 10:
      case 11:
      case 12:
      case 13:
      case 14:
      case 15: {
        tokenAmounts.push(parseEther("12000"));
        break;
      }

      default: {
        throw new Error("Incorrect number of points for account " + key + ": " + points);
      }
    }
  }

  return { tokenRecipients, tokenAmounts };
}

function writeAddresses() {
  const fs = require("fs");
  fs.writeFileSync(DEPLOYED_CONTRACTS_FILE_NAME, JSON.stringify(deployedContracts));
}

async function main() {
  console.log("Start governance deployment process...");
  await deployGovernance();
  console.log("Deployment finished!");
}

main()
  .then(() => console.log("Done."))
  .catch(console.error);
