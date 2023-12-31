import fs from "fs";

/**
 * Config required in order to run the governance deployer
 */
export interface DeployerConfig {
  //////////////
  ///// L1 /////
  //////////////
  /**
   * Minimum delay for an operation to become valid
   */
  L1_TIMELOCK_DELAY: number;
  /**
   * 9/12 security council can perform emergency upgrades
   */
  L1_9_OF_12_SECURITY_COUNCIL: string;

  //////////////
  ///// L2 /////
  //////////////
  /**
   * Minimum delay for an operation to become valid
   */
  L2_TIMELOCK_DELAY: number;
  /**
   * 9/12 security council can perform emergency upgrades
   */
  L2_9_OF_12_SECURITY_COUNCIL: string;
  /**
   * 7/12 security council can schedule proposals
   */
  L2_7_OF_12_SECURITY_COUNCIL: string;
  /**
   * Proportion of the circulating supply required to reach a quorum
   */
  L2_CORE_QUORUM_THRESHOLD: number;
  /**
   * Proportion of the circulating supply required to reach a quorum
   */
  L2_TREASURY_QUORUM_THRESHOLD: number;
  /**
   * The number of votes required in order for a voter to become a proposer
   */
  L2_PROPOSAL_THRESHOLD: number;
  /**
   * Delay (in number of blocks) since the proposal is submitted until voting power is fixed and voting starts
   */
  L2_VOTING_DELAY: number;
  /**
   * Delay (in number of blocks) since the proposal starts until voting ends
   */
  L2_VOTING_PERIOD: number;
  /**
   * The number of blocks that are required to pass since a proposal reaches quorum until its voting period ends
   */
  L2_MIN_PERIOD_AFTER_QUORUM: number;
  /**
   * Minimum delay for an operation to become valid
   */
  L2_TREASURY_TIMELOCK_DELAY: number;
  /**
   * Keccak256 hash of the  initial (i.e., at deploy time) constitution text
   */
  ARBITRUM_DAO_CONSTITUTION_HASH: string;

  ////////////////
  ///// Nova /////
  ////////////////
  /**
   * 9/12 security council can perform emergency upgrades
   */
  NOVA_9_OF_12_SECURITY_COUNCIL: string;
  NOVA_TOKEN_NAME: string;
  NOVA_TOKEN_SYMBOL: string;
  NOVA_TOKEN_DECIMALS: number;

  ////////////////////////
  ///// L2 Arb Token /////
  ////////////////////////
  /**
   * 10 billion tokens (we use parseEther in script to add decimals)
   */
  L2_TOKEN_INITIAL_SUPPLY: string;
  /**
   * Num of tokens to be sent to treasury
   */
  L2_NUM_OF_TOKENS_FOR_TREASURY: string;
  /**
   * Foundation address
   */
  L2_ADDRESS_FOR_FOUNDATION: string;
  /**
   * Num of tokens to be sent to foundation
   */
  L2_NUM_OF_TOKENS_FOR_FOUNDATION: string;
  /**
   * Team address
   */
  L2_ADDRESS_FOR_TEAM: string;
  /**
   * Num of tokens to be sent to team
   */
  L2_NUM_OF_TOKENS_FOR_TEAM: string;
  /**
   * Dao recipients address
   */
  L2_ADDRESS_FOR_DAO_RECIPIENTS: string;
  /**
   * Num of tokens to be sent to dao recipients
   */
  L2_NUM_OF_TOKENS_FOR_DAO_RECIPIENTS: string;
  /**
   * Investors escrow address
   */
  L2_ADDRESS_FOR_INVESTORS: string;
  /**
   * Num of tokens to be sent to investors
   */
  L2_NUM_OF_TOKENS_FOR_INVESTORS: string;
  /**
   * Airdrop claim start block number
   */
  L2_CLAIM_PERIOD_START: number;
  /**
   * Airdrop claim end block number
   */
  L2_CLAIM_PERIOD_END: number;
  /**
   * Batch size when setting the airdrop recipients in token distributor
   */
  RECIPIENTS_BATCH_SIZE: number;
  /**
   * Base Arb gas price of 0.1 gwei
   */
  BASE_L2_GAS_PRICE_LIMIT: number;
  /**
   * Acceptable upper limit for L1 gas price
   */
  BASE_L1_GAS_PRICE_LIMIT: number;
  /**
   * Block range for eth_getLogs calls
   */
  GET_LOGS_BLOCK_RANGE: number;
  /**
   * Sleep period between consecutive recipient batch posting in ms
   */
  SLEEP_TIME_BETWEEN_RECIPIENT_BATCHES_IN_MS: number;
}

export const loadDeployerConfig = async (fileLocation: string) => {
  return JSON.parse(fs.readFileSync(fileLocation).toString()) as DeployerConfig;
};
