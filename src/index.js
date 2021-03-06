import axios from 'axios';
import path from 'path';
import { createWriteStream, promises as fs } from 'fs';
import cheerio from 'cheerio';
import debug from 'debug';
import { keys } from 'lodash';
import url from 'url';
import Listr from 'listr';
import { getHtmlFileName, getNameFromLink } from './utils';
import extractSourceLinks from './parser';

const log = debug('page-loader');

// process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
// axios.defaults.adapter = httpAdapter;

const tagsMapping = {
  link: 'href',
  img: 'src',
  script: 'src',
};

const changeLinksInPageToRelative = (page, dir) => {
  const $ = cheerio.load(page);
  keys(tagsMapping).forEach((tag) => {
    $(tag).each((index, element) => {
      const temp = $(element).attr(tagsMapping[tag]);
      if (!temp) return;
      const { host } = url.parse(temp);
      if (host) return;
      if (temp) $(element).attr(tagsMapping[tag], path.join(dir, getNameFromLink(temp)));
    });
  });
  return $.html();
};


const loadResource = (loadedUrl, link, outputPath) => {
  const resultFilePath = path.join(outputPath, getNameFromLink(link));
  return axios({
    method: 'get',
    url: loadedUrl,
    responseType: 'stream',
  })
    .then(({ data }) => {
      log(`Fetch resource ${loadedUrl} to ${resultFilePath}`);
      data.pipe(createWriteStream(resultFilePath));
    })
    .catch((error) => {
      log(`Fetch resource ${loadedUrl} failed ${error.message}`);
      throw error;
    });
};

export const loadResources = (loadedUrl, outputPath, page) => {
  const relativeLinks = extractSourceLinks(page);

  const resultDirName = getNameFromLink(loadedUrl, 'directory');
  const resultOutput = path.join(outputPath, resultDirName);
  return fs.mkdir(resultOutput).then(() => {
    log(`Create folder ${resultOutput} for resources`);
    return relativeLinks.map((link) => {
      const { protocol } = new URL(loadedUrl);
      const resourceUrl = `${protocol}${link}`;
      return {
        title: `Load ${link}`,
        task: () => loadResource(resourceUrl, link, resultOutput),
      };
    });
  })
    .then((tasks) => {
      const listr = new Listr(tasks, { concurrent: true, exitOnError: false });
      listr.run();
    })
    .catch((error) => {
      log(`Create folder ${resultOutput} failed ${error.message}`);
      throw error;
    });
};

const loadPage = (loadedUrl, outputPath) => {
  const sourceDir = getNameFromLink(loadedUrl, 'directory');

  return axios.get(loadedUrl)
    .then((res) => {
      log(`Load page ${loadedUrl} to ${outputPath}`);
      const resultFilePath = path.join(outputPath, getHtmlFileName(loadedUrl));
      const page = res.data;
      const newPage = changeLinksInPageToRelative(page, sourceDir);

      return { resultFilePath, newPage, res };
    })
    .then(({ resultFilePath, newPage, res }) => fs.writeFile(resultFilePath, newPage)
      .then(() => loadResources(loadedUrl, outputPath, res.data))
      .catch((error) => {
        log(`Writing to ${resultFilePath} error, ${error.message}`);
        throw error;
      }));
};

export default loadPage;
