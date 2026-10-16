/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // pdfjs-dist (RFI markup viewer) has a Node-only require("canvas") that
    // never runs in the browser — tell webpack not to try to bundle it.
    config.resolve.alias.canvas = false;
    return config;
  },
};

module.exports = nextConfig;
