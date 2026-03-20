import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "export",
  trailingSlash: true,

  // This block will be commented out before running bun run build and only used in development to proxy API requests to the modem's web server.
  // async rewrites() {
  //   return [
  //     {
  //       source: "/cgi-bin/:path*",
  //       // For local development, we proxy API requests to the modem's web server. In production, these requests will be made directly from the client to the modem, so no proxy is needed.
  //       destination: "http://192.168.224.1/cgi-bin/:path*",
  //       // For tailscale users, we can use the local hostname instead of the IP address to avoid issues with dynamic IPs.
  //       // destination: "http://toothless.tail23767.ts.net/cgi-bin/:path*",
  //       basePath: false,
  //     },
  //   ];
  // },
};

export default nextConfig;
