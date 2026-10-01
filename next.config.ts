import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
    dangerouslyAllowLocalIP: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname:
          "br-frosty-mode-b3pvbk5x.storage.c-4.ap-southeast-1.aws.neon.tech",
        pathname: "/product-images/**",
      },
    ],
  },
};

export default nextConfig;