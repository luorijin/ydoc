const path = require('path');
const fs = require('fs-extra');
const utils = require('../utils.js');
const ydoc = require('../ydoc.js');
const ydocConfig = ydoc.config;
let defaultIndexPageName = 'index';
const defaultSummaryPage = 'summary.md';
const defaultNavPage = 'nav.md';
const generate = require('../generate.js').generatePage;
const runBatch = require('../generate.js').runBatch;
const parseSummary = require('./summary');
const parseMarkdown = require('./markdown');
const parsePage = require('./page.js');
const parseHtml = require('./html.js');
const parseNav = require('./nav');
const emitHook = require('../plugin.js').emitHook;
const url = require('url');
const color = require('bash-color');
const noox = require('noox');

utils.noox = new noox(path.resolve(__dirname, '../../theme/template'), {
  relePath: ydoc.relePath
});

function getIndexPath(filepath){
  let getIndexPathByType = (type)=> path.resolve(filepath, defaultIndexPageName + '.' + type);
  let types = ['md', 'jsx', 'html'];
  let contentFilepath;
  for(let index in types){
    contentFilepath = getIndexPathByType(types[index]);
    if(utils.fileExist(contentFilepath)){
      return contentFilepath;
    }
  }
}

function getBookSummary(filepath){
  let summaryFilepath = path.resolve(filepath, defaultSummaryPage);
  if(!utils.fileExist(summaryFilepath)) return null;
  let summary = parseMarkdown(summaryFilepath);
  fs.unlinkSync(summaryFilepath);
  return parseSummary(summary);
}

function getNav(filepath){
  let navFilepath = path.resolve(filepath, defaultNavPage);
  if(!utils.fileExist(navFilepath)) return null;
  let content = parseMarkdown(navFilepath);
  fs.unlinkSync(navFilepath);
  return parseNav(content);
}

function getBookContext(book, page){
  const context = utils.extend({}, book);
  context.page = page;
  context.config = ydocConfig;
  return context;
}

function handleMdPathToHtml(filepath){
  let fileObj = path.parse(filepath);
  if(fileObj.ext === '.md' || fileObj.ext === '.jsx'){
    let name = fileObj.name === defaultIndexPageName  ? 'index.html' : fileObj.name + '.html';
    return path.format({
      dir: fileObj.dir,
      base: name
    })
  }else{
    return path.format({
      dir: fileObj.dir,
      base: fileObj.base
    })
  }
}

exports.parseSite =async function(dist){
  try{    
    await emitHook('init');
    await emitHook('markdown', utils.md);
    let indexPath = await getIndexPath(dist);
    if(!indexPath){
      return utils.log.error(`The root directory of documents didn't find index page.`)
    }
    ydocConfig.nav = getNav(dist);
    const generateSitePage = generate(dist);
    generateSitePage({
      title: ydocConfig.title,
      page: {
        srcPath: indexPath,
        distPath: './index.html'
      },
      config: ydocConfig
    })
    await runBatch();

    let menus = ydocConfig.nav.menus[0].items;
    let books = [];
    for(let i=0; i< menus.length; i++){
      let item = menus[i];
      if( !item.ref || item.ref.indexOf('http') === 0){
        continue;
      }
      if(path.isAbsolute(item.ref)){
        item.ref = '.' + item.ref;
      }
      let bookHomePath = path.resolve(dist, item.ref);
      let indexFile = path.basename(bookHomePath);
      let bookPath = path.dirname(bookHomePath);
      let stats;
      try{
        stats = fs.statSync(bookPath);
      }catch(err){
        continue;
      }
      if(stats.isDirectory() && item[0] !== '_' && item[0] !== 'style' ){
        item.ref = handleMdPathToHtml(item.ref);
        books.push({
          bookPath: bookPath,
          indexFile: indexFile
        })
        
      }
    }

    for(let j=0; j< books.length ; j++){
      await parseBook(books[j].bookPath, books[j].indexFile);
    }

    let showpath = color.yellow( dist + '/index.html');
    utils.log.ok(`Generate Site "${ydocConfig.title}" ${showpath}`);

    await emitHook('finish')
  }catch(err){    
    utils.log.error(err);
  }
  
}

function getBookInfo(filepath){
  let page;
  if(path.extname(filepath) === '.md'){
    page = parsePage(parseMarkdown(filepath));
  }else if(path.extname(filepath) === '.jsx'){    
    page = {
      title: ydocConfig.title
    }
  }else{
    page = parsePage( parseHtml(filepath));
  }
  return {
    title: page.title || ydocConfig.title,
    description: page.description || ''
  }
}

// Schema
// const bookSchema = {
//   title: 'string',
//   description: 'string',
//   summary: {},
//   nav: {},
//   page: {
//     title: 'string',
//     description: 'string',
//     content: 'string',
//     prev: 'string',
//     next: 'string',
//     srcPath: 'string',
//     distPath: 'string'
//   },
//   asserts: { // asserts 资源
//     js: [],
//     css: []
//   },
//   config: {} //ydocConfig 配置
// }

async function parseBook(bookpath, indexFile){
  const book = {}; //书籍公共变量
  let extname = path.extname(indexFile);
  let name = path.basename(indexFile, extname);
  defaultIndexPageName = name;
  let indexPath = await getIndexPath(bookpath);
  if(!indexPath) return ;

  let summary = getBookSummary(bookpath);
  let baseInfo = getBookInfo(indexPath);
  utils.extend(book, baseInfo);
  book.summary = summary;

  await emitHook('book:before', {
    title: book.title,
    description: book.description,
    summary: summary
  });

  const generatePage = generate(bookpath);

  generatePage(getBookContext(book, {
    srcPath: indexPath,
    distPath: defaultIndexPageName + '.html'
  }))
  if(summary && Array.isArray(summary)) {
    await parseDocuments(summary); 
  }

  await runBatch();
  
  let showpath = color.yellow( bookpath + '/' + defaultIndexPageName + '.html');
  utils.log.ok(`Generate book "${book.title}" ${showpath}`);

  async function parseDocuments(summary){
    for(let index = 0; index< summary.length; index++){
      let item = summary[index];
      if(item.ref){
        let urlObj = url.parse(item.ref);
        if(urlObj.host) continue;
        let releativePath = urlObj.pathname;
        let absolutePath = path.resolve(bookpath, releativePath);
        if(utils.fileExist(absolutePath)){
          let releativeHtmlPath = handleMdPathToHtml(releativePath);
          urlObj.hash = urlObj.hash ? urlObj.hash : '';
          item.ref = releativeHtmlPath + urlObj.hash;
          generatePage(getBookContext(book, {
            srcPath: absolutePath,
            distPath: releativeHtmlPath
          }));
        }
        
      }

      if(item.articles && Array.isArray(item.articles) && item.articles.length > 0){
        parseDocuments(item.articles)
      }
    }
  }
  await emitHook('book');

}