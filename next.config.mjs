/** @type {import('next').NextConfig} */
const nextConfig = {
  // @apna/sdk ships /ui and /server as raw TS source (export map points at
  // src/*); Next 14 doesn't transpile node_modules by default, so route it
  // through Next's transpilePackages pipeline.
  transpilePackages: ['@apna/sdk'],
  reactStrictMode: true,
};

export default nextConfig;
