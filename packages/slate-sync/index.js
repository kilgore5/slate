const chalk = require('chalk');
const figures = require('figures');
const https = require('https');
const themekit = require('@shopify/themekit');
const slateEnv = require('@shopify/slate-env');
const SlateConfig = require('@shopify/slate-config');


const config = new SlateConfig(require('./slate-sync.schema'));

let deploying = false;
let filesToDeploy = [];

function maybeDeploy() {
  if (deploying) {
    return Promise.reject(new Error('Deploy already in progress.'));
  }

  if (filesToDeploy.length) {
    const files = [...filesToDeploy];
    filesToDeploy = [];
    return deploy('upload', files);
  }

  return Promise.resolve();
}

function _validateEnvValues() {
  const result = slateEnv.validate();

  if (!result.isValid) {
    console.log(
      chalk.red(
        `Some values in environment '${slateEnv.getEnvNameValue()}' are invalid:`,
      ),
    );
    result.errors.forEach((error) => {
      console.log(chalk.red(`- ${error}`));
    });

    process.exit(1);
  }
}

function _generateConfigFlags() {
  _validateEnvValues();

  const flags = {
    'password': slateEnv.getPasswordValue(),
    'themeid': slateEnv.getThemeIdValue(),
    'store': slateEnv.getStoreValue(),
    'env': slateEnv.getEnvNameValue(),
  };
  if (slateEnv.getTimeoutValue()) {
    flags['timeout'] = slateEnv.getTimeoutValue();
  }

  if (slateEnv.getIgnoreFilesValue()) {
    const ignoreFiles = slateEnv.getIgnoreFilesValue().split(':');
    flags['ignoredFiles'] = ignoreFiles
  }

  return flags;
}

/**
 * Deploy to Shopify using themekit.
 *
 * @param   cmd     String    The command to run
 * @param   files   Array     An array of files to deploy
 * @return          Promise
 */
async function deploy(cmd = '', files = []) {
  if (!['upload', 'replace'].includes(cmd)) {
    throw new Error(
      'shopify-deploy.deploy() first argument must be either "upload", "replace"',
    );
  }

  deploying = true;

  console.log(chalk.magenta(`\n${figures.arrowUp}  Uploading to Shopify...\n`));

  try {
    await promiseThemekitConfig();
    await promiseThemekitDeploy(cmd, files);
  } catch (error) {
    console.error('My Error', error);
  }

  deploying = false;

  return maybeDeploy;
}

async function promiseThemekitConfig() {
  const configFlags = _generateConfigFlags();

  try {
    await themekit.command(
      'configure',
      configFlags,
      {
        cwd: config.get('paths.theme.dist')
      }
    );
  } catch (error) {
    console.error('My Error', error);
  }
}

async function promiseThemekitDeploy(cmd, files) {
  const configFlags = _generateConfigFlags();

  if (files) {
    configFlags['files'] = files
  }

  if (cmd == "upload") {
    configFlags['noDelete'] = true
  }

  // slate-tools `deploy` command already prompts user
  // if they want to deploy to published theme,
  // so they only get here if they approve`
  configFlags['allow-live'] = true

  try {
    await themekit.command(
      'deploy',
      configFlags,
      {
        cwd: config.get('paths.theme.dist')
      }
    );
  } catch (error) {
    console.error('My Error', error);
  }
}

/**
 * Fetch the main theme ID from Shopify
 *
 * @param   env   String  The environment to check against
 * @return        Promise Reason for abort or the main theme ID
 */
function fetchMainThemeId() {
  _validateEnvValues();

  return new Promise((resolve, reject) => {
    https.get(
      {
        hostname: slateEnv.getStoreValue(),
        path: '/admin/themes.json',
        auth: `:${slateEnv.getPasswordValue}`,
        agent: false,
        headers: {
          'X-Shopify-Access-Token': slateEnv.getPasswordValue(),
        },
      },
      (res) => {
        let body = '';

        res.on('data', (datum) => (body += datum));

        res.on('end', () => {
          const parsed = JSON.parse(body);

          if (parsed.errors) {
            reject(
              new Error(
                `API request to fetch main theme ID failed: \n${JSON.stringify(
                  parsed.errors,
                  null,
                  '\t',
                )}`,
              ),
            );
            return;
          }

          if (!Array.isArray(parsed.themes)) {
            reject(
              new Error(
                `Shopify response for /admin/themes.json is not an array. ${JSON.stringify(
                  parsed,
                  null,
                  '\t',
                )}`,
              ),
            );
            return;
          }

          const mainTheme = parsed.themes.find((t) => t.role === 'main');

          if (!mainTheme) {
            reject(
              new Error(
                `No main theme in response. ${JSON.stringify(
                  parsed.themes,
                  null,
                  '\t',
                )}`,
              ),
            );
            return;
          }

          resolve(mainTheme.id);
        });
      },
    );
  });
}

module.exports = {
  sync(files = []) {
    if (!files.length) {
      return Promise.reject(new Error('No files to deploy.'));
    }

    filesToDeploy = [...new Set([...filesToDeploy, ...files])];

    return maybeDeploy();
  },

  replace() {
    return deploy('replace');
  },

  upload() {
    return deploy('upload');
  },

  fetchMainThemeId,
};
