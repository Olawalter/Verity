const path = require("path");

/**
 * RainbowKit's connector set pulls in @coinbase/cdp-sdk, which
 * DYNAMICALLY imports a family of x402 / Solana packages for a payments
 * feature Verity does not use. They are optional peers and are not
 * installed, so the bundler cannot resolve them and the build fails.
 *
 * Aliasing them to false is the correct fix rather than installing
 * several megabytes of dead dependency: the imports sit behind runtime
 * feature checks that never fire here.
 */
const OPTIONAL_UNUSED = [
  // The root of the tree. RainbowKit's wallets barrel re-exports every
  // wallet including the Base connector, so this arrives even when the
  // connector list never names it. Cutting the root removes the whole
  // x402 + Solana subtree in one alias instead of a dozen.
  "@coinbase/cdp-sdk",
  "@base-org/account",
  // …and the leaves it reaches for, in case another path imports them.
  "@x402/core", "@x402/core/client",
  "@x402/evm", "@x402/evm/exact/client", "@x402/evm/upto/client",
  "@x402/svm", "@x402/svm/exact/client",
  "@solana/kit", "@solana/web3.js",
  "@solana-program/token", "@solana-program/system",
];

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  outputFileTracingRoot: path.resolve(__dirname),

  turbopack: {
    resolveAlias: Object.fromEntries(
      OPTIONAL_UNUSED.map((m) => [m, { browser: "./src/lib/empty.ts", default: "./src/lib/empty.ts" }]),
    ),
  },

  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = { ...(config.resolve.alias || {}) };
    for (const m of OPTIONAL_UNUSED) config.resolve.alias[m] = false;
    return config;
  },
};
