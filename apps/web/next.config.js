/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  transpilePackages: ["@screenshare-guide/trpc"],
};

module.exports = nextConfig;
