/**
 * React SSR 基础测试，主要用于测试打包结果的正确性。这些测试*不包括*
 * - ❌ SSR 数据
 * - ❌ 多语言
 * - ❌ 延迟渲染
 * - ❌ 空路由
 */

// jest configuration
jest.setTimeout(5 * 60 * 1 * 1000);

//

const fs = require('fs-extra');
const path = require('path');
const util = require('util');
const execSync = require('child_process').exec;
const exec = util.promisify(require('child_process').exec);
const puppeteer = require('puppeteer');
const chalk = require('chalk');

//

const {
    filenameCurrentBundle
} = require('../../../packages/koot/defaults/before-build');
const removeTempProjectConfig = require('../../../packages/koot/libs/remove-temp-project-config');
const sleep = require('../../../packages/koot/utils/sleep');
const {
    styles: puppeteerTestStyles,
    customEnv: puppeteerTestCustomEnv,
    injectScripts: puppeteerTestInjectScripts,
    requestHidden404: testRequestHidden404,
    criticalAssetsShouldBeGzip: testAssetsGzip
} = require('../puppeteer-test');
const addCommand = require('../../libs/add-command-to-package-json');
const terminate = require('../../libs/terminate-process');
const waitForPort = require('../../libs/get-port-from-child-process');
const testHtmlRenderedByKoot = require('../../general-tests/html/rendered-by-koot');
const testFilesFromChunkmap = require('../../general-tests/bundle/check-files-from-chunkmap');

//

global.kootTest = true;
process.env.KOOT_TEST_MODE = JSON.stringify(true);

//

const projects = require('../../projects/get')();

const projectsToUse = projects.filter(
    project =>
        // Array.isArray(project.type) && project.type.includes('react-isomorphic')
        project.name === 'simple'
);

const commandTestBuild = 'koot-basetest';
const headless = true;

//

const defaultViewport = {
    width: 800,
    height: 800,
    deviceScaleFactor: 1
};

let browser;
beforeAll(() =>
    puppeteer
        .launch({
            headless,
            defaultViewport
        })
        .then(theBrowser => {
            browser = theBrowser;
        })
);
afterAll(() => browser.close());

//

let lastTime;
beforeEach(() => (lastTime = Date.now()));
afterEach(() => {});

//

/**
 * 测试项目
 * @async
 * @param {Number} port
 * @param {string} dist
 * @param {Object} settings
 */
const doTest = async (port, dist, settings = {}) => {
    const { isDev = false, enableJavascript = true, customEnv = {} } = settings;
    customEnv.notexist = undefined;

    const checkBackgroundResult = styleValue => {
        return styleValue.match(/url\([ "']*(.+?)[ '"]*\)/g).every(assetUri => {
            return assetUri.includes(
                isDev
                    ? `__koot_webpack_dev_server__/dist/assets`
                    : `/includes/assets/`
            );
        });
    };
    const setScaleFactor = async (scale = 1) => {
        await page.setViewport({
            ...defaultViewport,
            deviceScaleFactor: scale
        });
        await page.waitFor(200);
    };

    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();
    // await page.setJavaScriptEnabled(enableJavascript)
    if (!enableJavascript) {
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            if (/\.js$/.test(url)) request.abort();
            else request.continue();
        });
    }
    const failedResponse = [];
    require('../../libs/puppeteer/page-event-response-failed-response')(
        page,
        failedResponse
    );

    const origin = isNaN(port) ? port : `http://127.0.0.1:${port}`;

    const res = await page
        .goto(origin, {
            waitUntil: 'networkidle0'
        })
        .catch();

    // 请求应 OK
    expect(res.ok()).toBe(true);

    await testHtmlRenderedByKoot(await res.text());

    {
        // base 图片应该引用打包结果的文件
        const { base, baseRelative } = await page.evaluate(() => {
            const el = document.querySelector('[data-bg-type="base"]');
            if (!el) return {};
            const elRelative = document.querySelector(
                '[data-bg-type="base-relative"]'
            );
            if (!elRelative) return {};
            return {
                base: window.getComputedStyle(el).backgroundImage,
                baseRelative: window.getComputedStyle(elRelative)
                    .backgroundImage
            };
        });
        expect(checkBackgroundResult(base)).toBe(true);
        expect(checkBackgroundResult(baseRelative)).toBe(true);
    }

    {
        // respoinsive 图片应该引用打包结果的文件
        const result = {};
        const resultNative = {};
        const test = async scale => {
            await setScaleFactor(scale);
            const { value, valueNative } = await page.evaluate(() => {
                const el = document.querySelector(
                    '[data-bg-type="responsive"]'
                );
                if (!el) return {};
                const elNative = document.querySelector(
                    '[data-bg-type="responsive-native"]'
                );
                if (!elNative) return {};
                return {
                    value: window.getComputedStyle(el).backgroundImage,
                    valueNative: window.getComputedStyle(elNative)
                        .backgroundImage
                };
            });
            expect(checkBackgroundResult(value)).toBe(true);
            expect(checkBackgroundResult(valueNative)).toBe(true);
            result[scale] = value;
            resultNative[scale] = valueNative;
        };
        await test(1);
        await test(1.5);
        await test(2);
        // expect(result[1]).not.toBe(result[1.5]);
        // expect(result[1.5]).not.toBe(result[2]);
        // expect(resultNative[1]).not.toBe(resultNative[2]);
    }

    // 测试: react-router v3 兼容相关的属性
    {
        const context = await browser.createIncognitoBrowserContext();
        const page = await context.newPage();
        const testLocation = {
            pathname: '/route-test/123',
            search: '?test=aaa',
            hash: '#bbb'
        };
        await page.goto(
            origin +
                testLocation.pathname +
                testLocation.search +
                testLocation.hash,
            {
                waitUntil: 'networkidle2'
            }
        );
        const testResults = await page.evaluate(testLocation => {
            const results = {};
            const {
                props = {},
                propsInConnect = {},
                stateInConnect = {}
            } = window.__KOOT_TEST_ROUTE__;

            const isPropsValid = (props = {}) => {
                const {
                    location = {},
                    params = {},
                    route = {},
                    routeParams = {},
                    router = {},
                    routes
                } = props;

                return (
                    location.hash === testLocation.hash &&
                    location.pathname === testLocation.pathname &&
                    location.search === testLocation.search &&
                    params.testId === '123' &&
                    typeof route.component === 'function' &&
                    route.path === '/route-test/:testId' &&
                    routeParams.testId === '123' &&
                    typeof router.createHref === 'function' &&
                    typeof router.createKey === 'function' &&
                    typeof router.createLocation === 'function' &&
                    typeof router.createPath === 'function' &&
                    typeof router.getCurrentLocation === 'function' &&
                    typeof router.go === 'function' &&
                    typeof router.goBack === 'function' &&
                    typeof router.goForward === 'function' &&
                    typeof router.isActive === 'function' &&
                    typeof router.listen === 'function' &&
                    typeof router.listenBefore === 'function' &&
                    typeof router.location === 'object' &&
                    router.location.hash === testLocation.hash &&
                    router.location.pathname === testLocation.pathname &&
                    router.location.search === testLocation.search &&
                    typeof router.params === 'object' &&
                    router.params.testId === '123' &&
                    typeof router.push === 'function' &&
                    typeof router.replace === 'function' &&
                    Array.isArray(router.routes) &&
                    typeof router.setRouteLeaveHook === 'function' &&
                    typeof router.transitionTo === 'function' &&
                    typeof router.unsubscribe === 'function' &&
                    Array.isArray(routes)
                );
            };

            results.validLocationBeforeTransitionsInState =
                typeof stateInConnect.routing === 'object' &&
                typeof stateInConnect.routing.locationBeforeTransitions ===
                    'object' &&
                stateInConnect.routing.locationBeforeTransitions.hash ===
                    testLocation.hash &&
                stateInConnect.routing.locationBeforeTransitions.pathname ===
                    testLocation.pathname &&
                stateInConnect.routing.locationBeforeTransitions.search ===
                    testLocation.search;
            results.validPropsInConnect = isPropsValid(propsInConnect);
            results.validProps = isPropsValid(props);

            return results;
        }, testLocation);
        await context.close();

        expect(typeof testResults).toBe('object');
        expect(testResults.validLocationBeforeTransitionsInState).toBe(true);
        expect(testResults.validPropsInConnect).toBe(true);
        expect(testResults.validProps).toBe(true);
    }

    // 测试: 组件内手动 updatePageinfo
    {
        const context = await browser.createIncognitoBrowserContext();
        const page = await context.newPage();
        await page.goto(origin + '/route-test/123?test=aaa#bbb', {
            waitUntil: 'networkidle2'
        });

        await page.evaluate(() => {
            const button = document.querySelector(
                '#__test-manually-update-pageinfo'
            );
            if (!button) return {};
            button.click();
        });
        await sleep(1000);
        const { title, metaTestRoute } = await page.evaluate(() => {
            const title = document.title;
            const metaTestRoute = document.querySelector('meta[test-route]');

            if (!metaTestRoute) return { title };

            return {
                title,
                metaTestRoute: metaTestRoute.getAttribute('test-route')
            };
        });

        await context.close();

        expect(title).toBe('TEST ROUTE');
        expect(metaTestRoute).toBe('test-route');
    }

    // 测试: 使用工具函数手动更新 pageinfo
    {
        const test = async (changedTitle, changedMetas) => {
            const context = await browser.createIncognitoBrowserContext();
            const page = await context.newPage();
            await page.goto(origin, {
                waitUntil: 'networkidle2'
            });

            let { result, oldTitle } = await page.evaluate(
                (changedTitle, changedMetas) => {
                    const r = {
                        oldTitle: document.title
                    };

                    const $button = document.querySelector(
                        `#__test-client_update_pageinfo > button[data-change-title="${
                            changedTitle ? 'true' : 'false'
                        }"][data-change-metas="${
                            changedMetas ? 'true' : 'false'
                        }"]`
                    );
                    if (!$button) {
                        r.result = `no matched button`;
                        return r;
                    }

                    $button.click();

                    return r;
                },
                changedTitle,
                changedMetas
            );

            if (typeof result === 'string') {
                await context.close();
                return result;
            }

            await sleep(1000);

            result = await page.evaluate(
                (oldTitle, changedTitle, changedMetas) => {
                    if (changedTitle && document.title === oldTitle)
                        return 'title has not changed';
                    if (!changedTitle && document.title !== oldTitle)
                        return 'title has changed';

                    const hasOldMeta = !!document.querySelector(
                        'meta[page-name="home"]'
                    );
                    if (changedMetas && hasOldMeta)
                        return 'meta has not changed';
                    if (!changedMetas && !hasOldMeta) return 'meta has changed';

                    return true;
                },
                oldTitle,
                changedTitle,
                changedMetas
            );

            await context.close();

            return result;
        };

        expect(await test(true, false)).toBe(true);
        expect(await test(false, true)).toBe(true);
        expect(await test(true, true)).toBe(true);
    }

    await puppeteerTestStyles(page);
    await puppeteerTestCustomEnv(page, customEnv);
    await puppeteerTestInjectScripts(page);
    await testRequestHidden404(origin, browser);
    if (!isDev) await testAssetsGzip(origin, dist, browser);

    // TODO: 在设置了 sw 时有 sw 注册且没有报错

    // 测试: 没有失败的请求
    if (failedResponse.length) {
        console.log(
            'failedResponse',
            failedResponse.map(res => ({
                status: res.status(),
                url: res.url()
            }))
        );
    }
    expect(failedResponse.length).toBe(0);

    // 结束测试
    await page.close();
    await context.close();
};

/**
 * 测试项目开始前
 * @async
 * @param {String} cwd
 */
const beforeTest = async cwd => {
    // 重置
    await exec(`pm2 kill`);
    await removeTempProjectConfig(cwd);
};

/**
 * 测试项目结束后
 * @async
 * @param {String} cwd
 * @param {String} title
 */
const afterTest = async (cwd, title) => {
    await sleep(2 * 1000);
    await exec(`pm2 kill`);
    // 移除临时项目配置文件
    await removeTempProjectConfig(cwd);

    console.log(
        chalk.green('√ ') +
            chalk.green(`${(Date.now() - lastTime) / 1000}s `) +
            title
    );

    await sleep(100);
};

//

describe('测试: React 同构项目', () => {
    for (const project of projectsToUse) {
        const { name, dir } = project;
        describe(`项目: ${name}`, () => {
            test(`ENV: prod`, async () => {
                await beforeTest(dir);

                const configFile = `koot.config.js`;
                const dist = path.resolve(dir, 'dist');
                if (fs.existsSync(dist)) fs.emptyDirSync(dist);
                else fs.removeSync(dist);

                const customEnv = {
                    aaaaa: '' + Math.floor(Math.random() * 10000),
                    bbbbb: 'a1b2c3'
                };
                const commandName = `${commandTestBuild}-prod`;
                const command = `koot-start --koot-test -- bbbbb=${customEnv.bbbbb}`;
                await addCommand(commandName, command, dir);

                // console.log(
                //     customEnv,
                //     `npm run ${commandName} -- aaaaa=${customEnv.aaaaa}`
                // );

                const child = execSync(
                    `npm run ${commandName} -- aaaaa=${customEnv.aaaaa}`,
                    {
                        cwd: dir
                    }
                );
                const errors = [];

                await waitForPort(child);
                const port = require(path.resolve(dir, configFile)).port;
                child.stderr.on('data', err => {
                    errors.push(err);
                });

                expect(errors.length).toBe(0);

                // server-side 打包结果不应出现静态资源目录
                expect(
                    fs.existsSync(path.resolve(dist, 'server/index.js'))
                ).toBe(true);
                expect(fs.existsSync(path.resolve(dist, 'server/assets'))).toBe(
                    false
                );

                await testFilesFromChunkmap(dist);
                await doTest(port, dist, {
                    customEnv
                });
                await doTest(port, dist, {
                    enableJavascript: false,
                    customEnv
                });

                // 测试: 项目 package.json 里应有 koot 属性对象
                {
                    const {
                        version: kootVersion
                    } = require('koot/package.json');
                    const { koot: result } = require(path.resolve(
                        dir,
                        'package.json'
                    ));
                    expect(typeof result).toBe('object');
                    expect(result.version).toBe(kootVersion);
                }

                if (fs.existsSync(dist)) fs.emptyDirSync(dist);
                else fs.removeSync(dist);

                await terminate(child.pid);
                await afterTest(dir, 'ENV: prod');
            });

            test(`ENV: dev`, async () => {
                await beforeTest(dir);

                // const port = '8316'
                const dist = path.resolve(dir, 'dist');
                const customEnv = {
                    aaaaa: '' + Math.floor(Math.random() * 10000),
                    bbbbb: 'a1b2c3'
                };
                const commandName = `${commandTestBuild}-isomorphic-dev`;
                const command = `koot-dev --no-open --koot-test -- bbbbb=${customEnv.bbbbb}`;
                await addCommand(commandName, command, dir);

                const child = execSync(
                    `npm run ${commandName} -- aaaaa=${customEnv.aaaaa}`,
                    {
                        cwd: dir,
                        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
                    }
                );
                const errors = [];

                const port = await waitForPort(child, / on.*http:.*:([0-9]+)/);
                child.stderr.on('data', err => {
                    errors.push(err);
                });

                // console.log({
                //     port,
                //     errors,
                // })
                expect(errors.length).toBe(0);

                await doTest(port, dist, {
                    isDev: true,
                    customEnv
                });
                await doTest(port, dist, {
                    isDev: true,
                    customEnv,
                    enableJavascript: false
                });
                await terminate(child.pid);
                await afterTest(dir, 'ENV: dev');
            });

            test(`[config] bundleVersionsKeep: false`, async () => {
                await beforeTest(dir);

                const configFile = `koot.config.no-bundles-keep.js`;
                const dist = path.resolve(
                    dir,
                    require(path.resolve(dir, configFile)).dist
                );
                const commandName = `${commandTestBuild}-no_bundle_versions_keep`;
                const command = `koot-build -c --config ${configFile}`;
                const errors = [];

                await fs.remove(dist);
                await addCommand(commandName, command, dir);

                const chunks = `npm run ${commandName}`.split(' ');
                await new Promise(resolve => {
                    const child = require('child_process').spawn(
                        chunks.shift(),
                        chunks,
                        {
                            cwd: dir,
                            stdio: false,
                            shell: true
                        }
                    );
                    child.on('close', () => {
                        resolve();
                    });
                }).catch(e => errors.push(e));

                expect(errors.length).toBe(0);
                expect(fs.existsSync(dist)).toBe(true);
                expect(fs.existsSync(path.resolve(dist, 'public'))).toBe(true);
                expect(
                    fs.existsSync(
                        path.resolve(dist, 'public/service-worker.js')
                    )
                ).toBe(true);

                await testFilesFromChunkmap(dist);

                await fs.remove(dist);
                await afterTest(dir, '[config] bundleVersionsKeep: false');
            });

            test(`[config] bundleVersionsKeep: 3`, async () => {
                await beforeTest(dir);

                const configFile = `koot.config.bundles-keep.js`;
                const {
                    dist: _dist,
                    bundleVersionsKeep
                } = require(path.resolve(dir, configFile));
                const dist = path.resolve(dir, _dist);
                const commandName = `${commandTestBuild}-bundle_versions_keep`;
                const command = `koot-build -c --config ${configFile}`;
                const errors = [];

                await fs.remove(dist);
                await addCommand(commandName, command, dir);

                // 打包多次
                for (let i = 0; i < bundleVersionsKeep + 2; i++) {
                    const chunks = `npm run ${commandName}`.split(' ');
                    await new Promise(resolve => {
                        const child = require('child_process').spawn(
                            chunks.shift(),
                            chunks,
                            {
                                cwd: dir,
                                stdio: false,
                                shell: true
                            }
                        );
                        child.on('close', () => {
                            resolve();
                        });
                    }).catch(e => errors.push(e));
                }

                const dirPublic = path.resolve(dist, 'public');
                expect(errors.length).toBe(0);
                expect(fs.existsSync(dist)).toBe(true);
                expect(fs.existsSync(dirPublic)).toBe(true);
                expect(
                    fs.existsSync(path.resolve(dirPublic, 'service-worker.js'))
                ).toBe(false);

                const files = (await fs.readdir(dirPublic))
                    .filter(filename => filename !== filenameCurrentBundle)
                    .map(filename => path.resolve(dirPublic, filename));
                const kootVersionFolders = (await fs.readdir(dirPublic)).filter(
                    filename => {
                        const file = path.resolve(dirPublic, filename);
                        const lstat = fs.lstatSync(file);
                        if (!lstat.isDirectory()) return false;
                        return /^koot-[0-9]+$/.test(filename);
                    }
                );

                // 打包结果目录数量应该正确
                expect(kootVersionFolders.length).toBe(files.length);
                expect(kootVersionFolders.length).toBe(bundleVersionsKeep);

                // 当前打包结果版本应该存在
                const currentID =
                    kootVersionFolders[kootVersionFolders.length - 1];
                const dirCurrent = path.resolve(dirPublic, currentID);
                const fileCurrent = path.resolve(
                    dirPublic,
                    filenameCurrentBundle
                );
                expect(fs.existsSync(fileCurrent)).toBe(true);
                expect(currentID).toBe(fs.readFileSync(fileCurrent, 'utf-8'));
                expect(fs.existsSync(dirCurrent)).toBe(true);
                expect(
                    fs.existsSync(path.resolve(dirCurrent, 'includes'))
                ).toBe(true);

                await fs.remove(dist);
                await afterTest(dir, '[config] bundleVersionsKeep: 3');
            });
        });
    }
});
