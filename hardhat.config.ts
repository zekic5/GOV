import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.16",
    settings: {
      optimizer: {
        enabled: true,
        runs: 20000
      },
    },
  },
  paths: {
    sources: "./src",
    tests: "./test-ts",
    cache: "./cache_hardhat",
  },
};

export default config;
