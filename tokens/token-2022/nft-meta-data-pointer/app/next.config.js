// Notice that currently nft images from all domains can be fetched.
// This is not recommended for production use since there could be some security issues.

/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: '**',
            },
        ],
    },
};

module.exports = nextConfig;
