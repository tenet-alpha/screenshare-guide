/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@screenshare-guide/trpc"],
};

module.exports = nextConfig;
