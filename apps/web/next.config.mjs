/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.experiments = {
      ...(config.experiments || {}),
      asyncWebAssembly: true
    };

    config.module.rules.push({
      test: /\.wasm$/i,
      resourceQuery: /url/,
      type: "asset/resource"
    });

    return config;
  }
};

export default nextConfig;
