'use strict';

let _ = require('lodash');

let formatUtil = require('../../shared/util/formatUtil');
let regEx = require('../../shared/util/regEx');
let stringUtil = require('../../shared/util/stringUtil');
let TorrentNotificationService = require('./TorrentNotificationService');
let torrentStatusMap = require('../../shared/constants/torrentStatusMap');

const DEFAULT_DATA_KEYS = [
  // Torrent List data
  'hash',
  'added',
  'bytesDone',
  'downloadRate',
  'downloadTotal',
  'eta',
  'name',
  'percentComplete',
  'ratio',
  'sizeBytes',
  'status',
  'totalPeers',
  'totalSeeds',
  'uploadTotal',
  'uploadRate',
  'priority',
  'trackers',

  // Torrent Details data
  'creationDate',
  'freeDiskSpace',
  'connectedPeers',
  'connectedSeeds',
  'message',
  'basePath',
  'ignoreScheduler',
  'comment',
  'isPrivate',
  'directory',
  'filename',
  'isMultiFile',
  'tags'
];

class Torrent {
  constructor(clientData, opts) {
    if (!clientData) {
      return;
    }

    opts = opts || {};
    this.lastUpdated = opts.currentTime || Date.now();
    this.torrentData = this.getClientData(clientData, opts);
  }

  get basePath() {
    return this.torrentData.basePath;
  }

  get data() {
    // TODO: Only return the properties that are different than the last time
    // get was called. Perhaps identify the last time it was called by ID so
    // different consumers can use it. And/or allow users to get everything.
    return Object.assign({}, this.torrentData);
  }

  get status() {
    return this.torrentData.status || [];
  }

  get tags() {
    return this.torrentData.tags || [];
  }

  get trackers() {
    return this.torrentData.trackers || [];
  }

  getClientData(clientData, opts) {
    let keysToProcess = DEFAULT_DATA_KEYS;
    let torrentData = {};

    // If specific data keys were requested, use them. Otherwise, use defaults.
    if (opts.requestedData && _.isArray(opts.requestedData)) {
      keysToProcess = opts.requestedData;
    } else if (opts.requestedData) {
      console.warn('Torrent: requestedData mut be an array, using defaults.');
    }

    keysToProcess.forEach((key) => {
      // TODO: Use setters instead of constructing this transformation method.
      let fnName = `get${stringUtil.capitalize(key)}`;
      let keyData = null;

      // Some data needs transformation, so we check if there's a transformation
      // method on the Torrent class first. If not, we assume no transformation.
      if (typeof this[fnName] === 'function') {
        keyData = this[fnName](clientData);
      } else {
        keyData = clientData[key];
      }

      torrentData[key] = keyData;
    });

    TorrentNotificationService.compareNewTorrentData(this.data, torrentData);

    return torrentData;
  }

  getPeerCount(string) {
    // This lovely delimiter is defined in clientResponseUtil.
    let markerPosition = string.indexOf('@!@');
    return string.substr(0, markerPosition);
  }

  getEta(clientData) {
    let rate = clientData.downloadRate;
    let completed = clientData.bytesDone;
    let total = clientData.sizeBytes;

    if (rate > 0) {
      let cumSeconds = (total - completed) / rate;



      return formatUtil.secondsToDuration(cumSeconds);;
    } else {
      return 'Infinity';
    }
  }

  getPercentComplete(clientData) {
    let percentComplete = clientData.bytesDone / clientData.sizeBytes * 100;

    if (percentComplete > 0 && percentComplete < 10) {
      return Number(percentComplete.toFixed(2));
    } else if (percentComplete > 10 && percentComplete < 100) {
      return Number(percentComplete.toFixed(1));
    } else {
      return percentComplete;
    }
  }

  getStatus(clientData) {
    let isHashChecking = clientData.isHashChecking;
    let isComplete = clientData.isComplete;
    let isOpen = clientData.isOpen;
    let uploadRate = clientData.uploadRate;
    let downloadRate = clientData.downloadRate;
    let state = clientData.state;
    let message = clientData.message;

    let torrentStatus = [];

    if (isHashChecking === '1') {
      torrentStatus.push(torrentStatusMap.checking);
    } else if (isComplete === '1' && isOpen === '1' && state === '1') {
      torrentStatus.push(torrentStatusMap.complete);
      torrentStatus.push(torrentStatusMap.seeding);
  	} else if (isComplete === '1' && isOpen === '1' && state === '0') {
      torrentStatus.push(torrentStatusMap.paused);
  	} else if (isComplete === '1' && isOpen === '0') {
      torrentStatus.push(torrentStatusMap.stopped);
      torrentStatus.push(torrentStatusMap.complete);
  	} else if (isComplete === '0' && isOpen === '1' && state === '1') {
      torrentStatus.push(torrentStatusMap.downloading);
  	} else if (isComplete === '0' && isOpen === '1' && state === '0') {
      torrentStatus.push(torrentStatusMap.paused);
  	} else if (isComplete === '0' && isOpen === '0') {
      torrentStatus.push(torrentStatusMap.stopped);
  	}

    if (message.length) {
      torrentStatus.push(torrentStatusMap.error);
    }

    if (uploadRate === '0' && downloadRate === '0') {
      torrentStatus.push(torrentStatusMap.inactive);
    } else {
      torrentStatus.push(torrentStatusMap.active);
    }

    return torrentStatus;
  }

  getTags(clientData) {
    let tags = clientData.tags;

    if (tags === '') {
      return [];
    }

    return tags.split(',').sort().map((tag) => {
      return decodeURIComponent(tag);
    });
  }

  getTotalPeers(clientData) {
    return this.getPeerCount(clientData.totalPeers);
  }

  getTotalSeeds(clientData) {
    return this.getPeerCount(clientData.totalSeeds);
  }

  getTrackers(clientData) {
    // This lovely delimiter is defined in clientResponseUtil.
    let trackers = clientData.trackers.split('@!@');
    let trackerDomains = [];

    trackers.forEach((tracker) => {
      let domain = regEx.domainName.exec(tracker);

      if (domain && domain[1]) {
        domain = domain[1];

        let domainSubsets = domain.split('.');
        let desiredSubsets = 2;
        let subsetMinLength = 3;

        if (domainSubsets.length > desiredSubsets) {
          let lastDesiredSubset = domainSubsets[domainSubsets.length - desiredSubsets];
          if (lastDesiredSubset.length <= 3) {
            desiredSubsets++;
          }
        }

        domain = domainSubsets.slice(desiredSubsets * -1).join('.');

        trackerDomains.push(domain);
      }
    });

    return trackerDomains;
  }

  getAdded(clientData) {
    return this.cleanUpDate(clientData.added);
  }

  getCreationDate(clientData) {
    return this.cleanUpDate(clientData.creationDate);
  }

  cleanUpDate(dirtyDate) {
    if (!dirtyDate) {
      return '';
    }

    let date = dirtyDate.trim();

    if (date === '0') {
      return '';
    }

    return date;
  }

  updateData(clientData, opts) {
    // TODO: Communicate to TorrentCollection which props changed.
    this.lastUpdated = opts.currentTime || Date.now();
    this.torrentData = this.getClientData(clientData, opts);
  }
}

module.exports = Torrent;
