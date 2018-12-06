const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const bunyan = require('bunyan');
const stringHash = require('string-hash');
const ncp = require('ncp').ncp;
const Namespaces = require('./components/namespaces');
const Elements = require('./components/elements');

const showdown = require('showdown');
const mdConverter = new showdown.Converter();

// Variables for Drupal. Specified globally to ensure they're consistent across files
const exportTime = new Date().toISOString();
const exportVersion = '0.1.0';

var rootLogger = bunyan.createLogger({ name: 'shr-json-javadoc' });
var logger = rootLogger;
function setLogger(bunyanLogger) {
  rootLogger = logger = bunyanLogger;
  require('./components/constraints').setLogger(logger);
}

function compileJavadoc(cimcore, outPath, configureForIG=false) {
  // Run main code
  return new SHR(cimcore, outPath, configureForIG);
}

function exportToPath(compiledSHR, outPath) {
  // export HTML
  compiledSHR.outDirectory = outPath;
  compiledSHR.generateHTML();
}

function makeHtml(md) {
  // First we need to escape < and >
  if (md != null) {
    md = md.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  mdConverter.setOption('simplifiedAutoLink', true);
  return mdConverter.makeHtml(md);
}

function idFor(str) {
  return stringHash(str);
}

function makeSummaryHtml(md) {
  // First we need to escape < and >
  if (md != null) {
    md = md.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  return mdConverter.makeHtml(md);
}

// Function to generate and write html from an ejs template
function renderEjsFile(template, pkg, outDirectory, filePath) {
  const destination = path.join(outDirectory, filePath);
  ejs.renderFile(path.join(__dirname, template), Object.assign(pkg, { makeHtml: makeHtml, makeSummaryHtml: makeSummaryHtml, attachment: filePath, drupalVars: { exportTime: exportTime, exportVersion: exportVersion, idFor: idFor } }), (error, htmlText) => {
    if (error) logger.error('Error rendering model doc: %s', error);
    else fs.writeFileSync(destination, htmlText);
  });
}

/*
 *  SHR class holds the canonical json in memory.
 *  Uses Namespaces and Elements classes to hold the data.
 */
class SHR {
  constructor(cimcore, out, configureForIG) {
    this.outDirectory = out;
    this.configureForIG = configureForIG;
    this.elements = new Elements(cimcore.projectInfo, configureForIG);
    this.namespaces = new Namespaces();
    this.children = {};
    this.readFiles(cimcore);
    this.elements.flatten();
  }

  set metaData(metaData) { this._metaData = metaData;}
  get metaData() { return this._metaData; }

  // Read in the canonical json files
  // Assumes first level of directories are namespaces
  readFiles(cimcore) {
    logger.info('Compiling Documentation for %s namespaces...', Object.keys(cimcore.namespaces).length);
    this.metaData = cimcore.projectInfo;
    for (const ns in cimcore.namespaces) {
      const namespace = this.namespaces.get(ns);
      namespace.description = cimcore.namespaces[ns].description;
    }

    for (const de of cimcore.dataElements) {
      const deClone = JSON.parse(JSON.stringify(de));
      this.elements.add(deClone);
      const element = this.elements.get(deClone.fqn);
      const namespace = this.namespaces.get(element.namespace);
      namespace.addElement(element);
      element.namespacePath = namespace.path;
    }
  }

  // Builds the output directory folder structure
  buildOutputDirectory() {
    if (!fs.existsSync(this.outDirectory))
      fs.mkdirSync(this.outDirectory);

    for (const namespace of this.namespaces.list()) {
      const dir = path.join(this.outDirectory, namespace.path);
      if (!fs.existsSync(dir))
        fs.mkdirSync(dir);
    }
  }

  // Copy the required files to output directory
  // This includes images, index.html, and the stylesheet
  copyRequiredFiles() {
    ncp(path.join(__dirname, 'required'), this.outDirectory, (error) => {
      if (error) {
        logger.error('Error copying files for export of model doc: %s', error);
        return;
      }
    });
  }

  // Builds the package files that contain lists of the elements for
  // a given namespace
  buildPackageFiles() {
    for (const namespace of this.namespaces.list()) {
      const fileName = `${namespace.path}-pkg.html`;
      const filePath = path.join(namespace.path, fileName);
      const ejsPkg = { elements: namespace.elements.sort(), namespace: namespace, metaData: this.metaData };
      renderEjsFile('templates/pkg.ejs', ejsPkg, this.outDirectory, filePath);
    }
  }

  // Builds the info files that describe each namespace
  buildInfoFiles() {
    for (const namespace of this.namespaces.list()) {
      const fileName = `${namespace.path}-info.html`;
      const filePath = path.join(namespace.path, fileName);
      const ejsPkg = { namespace: namespace, metaData: this.metaData  };
      renderEjsFile('templates/info.ejs', ejsPkg, this.outDirectory, filePath);
    }
  }

  // Builds the overview list which displays all the namespaces
  buildOverviewFrame() {
    const ejsPkg = { namespaces: this.namespaces.list(), metaData: this.metaData  };
    const filePath = 'overview-frame.html';
    renderEjsFile('templates/overview-frame.ejs', ejsPkg, this.outDirectory, filePath);
  }

  // Builds overiew list of all the data elements on the main page
  buildOverviewSummary() {
    const ejsPkg = { elements: this.elements.list(), metaData: this.metaData, namespaces: this.namespaces.list() };
    const filePath = 'overview-summary.html';
    renderEjsFile('templates/overview-summary.ejs', ejsPkg, this.outDirectory, filePath);
  }

  // Builds list of all the data elements on the main page
  buildAllElementsFrame() {
    const ejsPkg = { elements: this.elements.list().filter(de=>de.hierarchy.length > 0), metaData: this.metaData  };
    const filePath = path.join('allclasses-frame.html');
    renderEjsFile('templates/allclasses-frame.ejs', ejsPkg, this.outDirectory, filePath);
  }

  // Builds pages for each data element
  buildDataElements() {
    logger.info('Building documentation pages for %s elements...', this.elements.list().length);
    for (const element of this.elements.list()) {
      var dataElements = this.elements.elements;
      const ejsPkg = { element: element, dataElements: dataElements, metaData: this.metaData  };
      const fileName = `${element.name}.html`;
      const filePath = path.join(element.namespacePath, fileName);
      renderEjsFile('templates/dataElement.ejs', ejsPkg, this.outDirectory, filePath);
    }
  }

  // Runs all the different components to generate the html files
  generateHTML() {
    this.buildOutputDirectory();
    this.copyRequiredFiles();
    this.buildPackageFiles();
    this.buildInfoFiles();
    this.buildOverviewFrame();
    this.buildOverviewSummary();
    this.buildAllElementsFrame();
    this.buildDataElements();
  }
}

module.exports = {setLogger, compileJavadoc, exportToPath};
