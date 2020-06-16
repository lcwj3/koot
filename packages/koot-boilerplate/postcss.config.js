module.exports = {
    plugins: [
        require('autoprefixer'),
        require('cssnano')({
            preset: [
                'default',
                {
                    discardComments: {
                        removeAll: true,
                    },
                    camelCase: true,
                    normalizeWhitespace: false,
                    zindex: false,
                },
            ],
        }),
    ],
};
