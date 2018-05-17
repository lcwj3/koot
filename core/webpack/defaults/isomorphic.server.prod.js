const common = require('../common')

const factoryConfig = async ({
    RUN_PATH,
    // CLIENT_DEV_PORT,
}) => {

    // let { RUN_PATH, CLIENT_DEV_PORT, APP_KEY } = opt

    return {
        mode: "production",
        target: 'async-node',
        node: {
            __dirname: true
        },
        watch: false,
        output: {
            filename: 'index.js',
            chunkFilename: 'chunk.[name].[chunkhash].js',
            path: `${RUN_PATH}/${common.outputPath}/server`,
            // publicPath: `/[need_set_in_app:__webpack_public_path__]/`,
            publicPath: `/`,
        },
        plugins: [],
        externals: common.filterExternalsModules(),
    }
}

module.exports = async (opt) => await factoryConfig(opt)
