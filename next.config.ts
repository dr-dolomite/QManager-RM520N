import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "export", 
  //   async rewrites() {
  //   return [
  //     {
  //       source: '/cgi-bin/:path*',
  //       destination: 'http://192.168.224.1/cgi-bin/:path*',
  //       basePath: false,
  //     },
  //   ];
  // },
};

export default nextConfig;
