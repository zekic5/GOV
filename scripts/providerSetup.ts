/*
 * Copyright 2021, Offchain Labs, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* eslint-env node */
"use strict";

import { JsonRpcProvider, Provider } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";
import dotenv from "dotenv";
import { Signer } from "ethers";
import { ArbSdkError } from "@arbitrum/sdk/dist/lib/dataEntities/errors";
import { getProvidersAndSetupNetworks } from "../test-ts/testSetup";
import path from "path";
import { DeployerConfig, loadDeployerConfig } from "./deployerConfig";
import { getL2Network, L2Network } from "@arbitrum/sdk";
import { ClaimRecipients, Recipients, loadRecipients, mapPointsToAmounts } from "./testUtils";
import fs from "fs";

dotenv.config();

const ETH_CHAIN_ID = 1;
const ARBITRUM_ONE_CHAIN_ID = 42161;
const ARBITRUM_NOVA_CHAIN_ID = 42170;

// dotenv config used in case of deploying to production
// in case of local env testing, config is extracted in `testSetup()`
export const envVars = {
  isLocalDeployment: process.env["DEPLOY_TO_LOCAL_ENVIRONMENT"] as string,
  ethRpc: process.env["ETH_URL"] as string,
  arbRpc: process.env["ARB_URL"] as string,
  novaRpc: process.env["NOVA_URL"] as string,
  ethDeployerKey: process.env["ETH_KEY"] as string,
  arbDeployerKey: process.env["ARB_KEY"] as string,
  novaDeployerKey: process.env["NOVA_KEY"] as string,
  deployerConfigLocation: process.env["DEPLOY_CONFIG_FILE_LOCATION"] as string,
  vestedRecipientsLocation: process.env["VESTED_RECIPIENTS_FILE_LOCATION"] as string,
  daoRecipientsLocation: process.env["DAO_RECIPIENTS_FILE_LOCATION"] as string,
  claimRecipientsLocation: process.env["CLAIM_RECIPIENTS_FILE_LOCATION"] as string,
  deployedContractsLocation: process.env["DEPLOYED_CONTRACTS_FILE_LOCATION"] as string,
  arbTransferAssetsTXsLocation: process.env["ARB_TXS_FILE_LOCATION"] as string,
  novaTransferAssetsTXsLocation: process.env["NOVA_TXS_FILE_LOCATION"] as string,
};

const checkEnvVars = (conf: typeof envVars) => {
  if (conf.isLocalDeployment == undefined) throw new Error("Missing isLocalDeployment in env vars");
  if (conf.ethRpc == undefined) throw new Error("Missing ethRpc in env vars");
  if (conf.arbRpc == undefined) throw new Error("Missing arbRpc in env vars");
  if (conf.novaRpc == undefined) throw new Error("Missing novaRpc in env vars");
  // eth key can sometimes be inferred for local
  if (!conf.isLocalDeployment && conf.ethDeployerKey == undefined)
    throw new Error("Missing ethDeployerKey in env vars");
  if (conf.arbDeployerKey == undefined) throw new Error("Missing arbDeployerKey in env vars");
  if (conf.novaDeployerKey == undefined) throw new Error("Missing novaDeployerKey in env vars");
  if (conf.deployerConfigLocation == undefined)
    throw new Error("Missing deployerConfigLocation in env vars");
  if (!fs.existsSync(conf.deployerConfigLocation))
    throw new Error(`Missing file at ${conf.deployerConfigLocation}`);

  if (conf.vestedRecipientsLocation == undefined)
    throw new Error("Missing vestedRecipientsLocation in env vars");
  if (!fs.existsSync(conf.vestedRecipientsLocation))
    throw new Error(`Missing file at ${conf.vestedRecipientsLocation}`);

  if (conf.daoRecipientsLocation == undefined)
    throw new Error("Missing daoRecipientsLocation in env vars");
  if (!fs.existsSync(conf.daoRecipientsLocation))
    throw new Error(`Missing file at ${conf.daoRecipientsLocation}`);

  if (conf.claimRecipientsLocation == undefined)
    throw new Error("Missing claimRecipientsLocation in env vars");
  if (!fs.existsSync(conf.claimRecipientsLocation))
    throw new Error(`Missing file at ${conf.claimRecipientsLocation}`);

  if (conf.deployedContractsLocation == undefined)
    throw new Error("Missing deployedContractsLocation in env vars");
  if (conf.arbTransferAssetsTXsLocation == undefined)
    throw new Error("Missing arbTransferAssetsTXsLocation in env vars");
  if (conf.novaTransferAssetsTXsLocation == undefined)
    throw new Error("Missing novaTransferAssetsTXsLocation in env vars");
};

export const getSigner = (provider: JsonRpcProvider, key?: string) => {
  if (!key && !provider) throw new ArbSdkError("Provide at least one of key or provider.");
  if (key) return new Wallet(key).connect(provider);
  else return provider.getSigner(0);
};

export const loadDaoRecipients = () => {
  checkEnvVars(envVars);

  const daoRecipientsFileLocation = path.join(__dirname, "..", envVars.daoRecipientsLocation);
  return loadRecipients(daoRecipientsFileLocation);
};

export const loadVestedRecipients = () => {
  checkEnvVars(envVars);

  const vestedRecipientsFileLocation = path.join(__dirname, "..", envVars.vestedRecipientsLocation);
  return loadRecipients(vestedRecipientsFileLocation);
};

export const loadClaimRecipients = (): Recipients => {
  checkEnvVars(envVars);

  const tokenRecipientsByPoints = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", envVars.claimRecipientsLocation)).toString()
  ) as ClaimRecipients;
  const { tokenRecipients, tokenAmounts } = mapPointsToAmounts(tokenRecipientsByPoints);

  return Object.fromEntries(tokenRecipients.map((tr, i) => [tr, tokenAmounts[i]]));
};

// store address for every deployed contract
export interface DeployProgressCache {
  l1UpgradeExecutorLogic?: string;
  l2TimelockLogic?: string;
  l2GovernorLogic?: string;
  l2FixedDelegateLogic?: string;
  l2TokenLogic?: string;
  l2UpgradeExecutorLogic?: string;
  l1GovernanceFactory?: string;
  l2GovernanceFactory?: string;
  l1ReverseCustomGatewayLogic?: string;
  l1ReverseCustomGatewayProxy?: string;
  l2ReverseCustomGatewayLogic?: string;
  l2ReverseCustomGatewayProxy?: string;
  l1TokenLogic?: string;
  l1TokenProxy?: string;
  novaProxyAdmin?: string;
  novaUpgradeExecutorLogic?: string;
  novaUpgradeExecutorProxy?: string;
  novaTokenLogic?: string;
  novaTokenProxy?: string;
  l2CoreGoverner?: string;
  l2CoreTimelock?: string;
  l2Executor?: string;
  l2ProxyAdmin?: string;
  l2Token?: string;
  l2TreasuryGoverner?: string;
  l2ArbTreasury?: string;
  arbitrumDAOConstitution?: string;
  l1Executor?: string;
  l1ProxyAdmin?: string;
  l1Timelock?: string;
  step3Executed?: boolean;
  executorRolesSetOnNova1?: boolean;
  executorRolesSetOnNova2?: boolean;
  registerTokenArbOne1?: boolean;
  registerTokenArbOne2?: boolean;
  registerTokenArbOne3?: boolean;
  registerTokenNova?: boolean;
  l2TokenTask1?: boolean;
  l2TokenTask2?: boolean;
  l2TokenTask3?: boolean;
  l2TokenTask4?: boolean;
  vestedWalletInProgress?: boolean;
  vestedWalletFactory?: string;
  l2TokenDistributor?: string;
  l2TokenTransferTokenDistributor?: boolean;
  l2TokenTransferOwnership?: boolean;
  distributorSetRecipientsStartBlock?: number;
  distributorSetRecipientsEndBlock?: number;
}

export const loadDeployedContracts = (): DeployProgressCache => {
  if (!fs.existsSync(envVars.deployedContractsLocation)) return {};
  return JSON.parse(
    fs.readFileSync(envVars.deployedContractsLocation).toString()
  ) as DeployProgressCache;
};

export const updateDeployedContracts = (cache: DeployProgressCache) => {
  fs.writeFileSync(envVars.deployedContractsLocation, JSON.stringify(cache, null, 2));
};

/**
 * Fetch deployers and token receiver.
 * If script is used in local testing environment it uses `testSetup` to set up testing environment.
 * @returns
 */
export const getDeployersAndConfig = async (): Promise<{
  ethDeployer: Signer;
  arbDeployer: Signer;
  novaDeployer: Signer;
  deployerConfig: DeployerConfig;
  arbNetwork: L2Network;
  novaNetwork: L2Network;
  daoRecipients: Recipients;
  vestedRecipients: Recipients;
  claimRecipients: Recipients;
}> => {
  // make sure we were able to load the env vars
  checkEnvVars(envVars);
  console.log("Environment variables", {
    ...envVars,
    arbDeployerKey: "******",
    ethDeployerKey: "******",
    novaDeployerKey: "******",
  });

  const daoRecipients = loadDaoRecipients();
  const vestedRecipients = loadVestedRecipients();
  const claimRecipients = loadClaimRecipients();

  if (isLocalDeployment()) {
    // setup local test environment
    const {
      l2Provider,
      l1Provider,
      l2Network: arbNetwork,
    } = await getProvidersAndSetupNetworks({
      l1Url: envVars.ethRpc,
      l2Url: envVars.arbRpc,
      networkFilename: "files/local/network.json",
    });

    const { l2Provider: novaProvider, l2Network: novaNetwork } = await getProvidersAndSetupNetworks(
      {
        l1Url: envVars.ethRpc,
        l2Url: envVars.novaRpc,
        networkFilename: "files/local/networkNova.json",
      }
    );

    const l1Deployer = getSigner(l1Provider, envVars.ethDeployerKey);
    const l2Deployer = getSigner(l2Provider, envVars.arbDeployerKey);
    const novaDeployer = getSigner(novaProvider, envVars.novaDeployerKey);

    // check that production chains are not mistakenly used in local env
    if (l1Deployer.provider) {
      const l1ChainId = (await l1Deployer.provider.getNetwork()).chainId;
      if (l1ChainId == ETH_CHAIN_ID) {
        throw new Error("Production chain ID used in test env for L1");
      }
    }
    if (l2Deployer.provider) {
      const l2ChainId = (await l2Deployer.provider.getNetwork()).chainId;
      if (l2ChainId == ARBITRUM_ONE_CHAIN_ID) {
        throw new Error("Production chain ID used in test env for L2");
      }
    }
    if (novaDeployer.provider) {
      const novaChainId = (await novaDeployer.provider.getNetwork()).chainId;
      if (novaChainId == ARBITRUM_NOVA_CHAIN_ID) {
        throw new Error("Production chain ID used in test env for Nova");
      }
    }

    const testDeployerConfigName = path.join(__dirname, "..", envVars.deployerConfigLocation);
    const deployerConfig = await loadDeployerConfig(testDeployerConfigName);

    return {
      ethDeployer: l1Deployer,
      arbDeployer: l2Deployer,
      novaDeployer: novaDeployer,
      deployerConfig,
      arbNetwork,
      novaNetwork,
      daoRecipients,
      vestedRecipients,
      claimRecipients,
    };
  } else {
    // deploying to production
    const ethProvider = new JsonRpcProvider(envVars.ethRpc);
    const arbProvider = new JsonRpcProvider(envVars.arbRpc);
    const novaProvider = new JsonRpcProvider(envVars.novaRpc);

    // check that production chain IDs are used in production mode
    const ethChainId = (await ethProvider.getNetwork()).chainId;
    if (ethChainId != ETH_CHAIN_ID) {
      throw new Error("Production chain ID should be used in production mode for L1");
    }
    const arbChainId = (await arbProvider.getNetwork()).chainId;
    if (arbChainId != ARBITRUM_ONE_CHAIN_ID) {
      throw new Error("Production chain ID should be used in production mode for L2");
    }
    const novaChainId = (await novaProvider.getNetwork()).chainId;
    if (novaChainId != ARBITRUM_NOVA_CHAIN_ID) {
      throw new Error("Production chain ID should be used in production mode for Nova");
    }

    const ethDeployer = getSigner(ethProvider, envVars.ethDeployerKey);
    const arbDeployer = getSigner(arbProvider, envVars.arbDeployerKey);
    const novaDeployer = getSigner(novaProvider, envVars.novaDeployerKey);

    const testDeployerConfigName = path.join(__dirname, "..", envVars.deployerConfigLocation);
    const deployerConfig = await loadDeployerConfig(testDeployerConfigName);

    const arbNetwork = await getL2Network(arbProvider);
    const novaNetwork = await getL2Network(novaProvider);

    return {
      ethDeployer,
      arbDeployer,
      novaDeployer,
      deployerConfig,
      arbNetwork,
      novaNetwork,
      daoRecipients,
      vestedRecipients,
      claimRecipients,
    };
  }
};

/**
 * Fetch providers for mainnet, ArbitrumOne and Nova.
 * RPCs endpoints are loaded from env vars:
 *  - ETH_URL, ARB_URL, NOVA_URL for test deployment in local env (DEPLOY_TO_LOCAL_ENVIRONMENT = 'true')
 *  - MAINNET_RPC, ARB_ONE_RPC, NOVA_RPC for production deployment (DEPLOY_TO_LOCAL_ENVIRONMENT = 'false')
 *
 * @returns
 */
export const getProviders = async (): Promise<{
  ethProvider: Provider;
  arbProvider: Provider;
  novaProvider: Provider;
  deployerConfig: DeployerConfig;
  arbNetwork: L2Network;
  novaNetwork: L2Network;
}> => {
  const { arbDeployer, deployerConfig, ethDeployer, novaDeployer, arbNetwork, novaNetwork } =
    await getDeployersAndConfig();

  return {
    ethProvider: ethDeployer.provider!,
    arbProvider: arbDeployer.provider!,
    novaProvider: novaDeployer.provider!,
    deployerConfig,
    arbNetwork,
    novaNetwork,
  };
};

/**
 * Get addresses for every deployer account.
 * @returns
 */
export const getDeployerAddresses = async (): Promise<{
  ethDeployerAddress: string;
  arbDeployerAddress: string;
  novaDeployerAddress: string;
}> => {
  const { ethDeployer, arbDeployer, novaDeployer } = await getDeployersAndConfig();
  const ethDeployerAddress = await ethDeployer.getAddress();
  const arbDeployerAddress = await arbDeployer.getAddress();
  const novaDeployerAddress = await novaDeployer.getAddress();

  return {
    ethDeployerAddress,
    arbDeployerAddress,
    novaDeployerAddress,
  };
};

/**
 * Governance will be deployed to Nova only if env var 'DEPLOY_GOVERNANCE_TO_NOVA' is set to 'true'.
 *
 * @returns
 */
export function isDeployingToNova(): boolean {
  const deployToNova = process.env["DEPLOY_GOVERNANCE_TO_NOVA"] as string;
  return deployToNova === "true";
}

/**
 * Governance is deployed to production when 'DEPLOY_TO_LOCAL_ENVIRONMENT' is set to 'false', otherwise it's deployed to local test env.
 *
 * @returns
 */
export function isLocalDeployment(): boolean {
  return envVars.isLocalDeployment !== "false";
}