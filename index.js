/**
 * Created by macdja38 on 2017-03-15.
 */
"use strict";

let https = require("https");
let url = require("url");
let stream = require("stream");
let EventEmitter = require("events").EventEmitter;
let Readable = stream.Readable;

let streamResume = {};
Object.assign(streamResume, https);

// let longjohn = require("longjohn");

class RebindableEmitter extends EventEmitter {
  constructor(currentEmitter) {
    super();
    this._onNewListener = this._onNewListener.bind(this);
    this._onRemoveListener = this._onRemoveListener.bind(this);
    this._activeEvents = [];
    this._filteredEvents = [];
    this._currentEmitter = currentEmitter;
    this.on("newListener", this._onNewListener);
    this.on("removeListener", this._onRemoveListener);
  }

  bindTo(emitter) {
    let oldEmitter = this._currentEmitter;
    this._currentEmitter = emitter;
    this._activeEvents.forEach((name) => {
      oldEmitter.listeners(name).forEach((listener) => {
        this._currentEmitter.on(name, listener);
      });
      oldEmitter.removeAllListeners(name);
    });
  }

  addFilter(name, filterFunction) {
    if (!this._filteredEvents.includes(name)) {
      this._filteredEvents.push(name);
    }
    this._currentEmitter.listeners(name).forEach((listener) => {
      this.on(name, listener);
    });
    this._currentEmitter.removeAllListeners(name);
    this._currentEmitter.on(name, (data) => {if (filterFunction(data) === true) {this.emit(name, data)}});
  }

  _onNewListener(name, listener) {
    console.log(listener, this._onNewListener);
    if (listener === this._onNewListener) return;
    if (!this._activeEvents.includes(name)) {
      this._activeEvents.push(name);
    }
    if (this._filteredEvents.includes(name)) {
      this.on(name, listener);
    } else {
      this._currentEmitter.on(name, listener);
    }
  }

  _onRemoveListener(name, listener) {
    if (this._activeEvents.includes(name)) {
      this._activeEvents = this._activeEvents.splice(this._activeEvents.indexOf(name), 1);
    }
    this._currentEmitter.removeListener(name, listener);
  }
}

class ResSubstitute extends RebindableEmitter {
  constructor(res) {
    super(res);
    this._res = res;
  }

  end() {
    this._res.end();
  }
}

class OutputStream extends Readable {
  constructor(options, httpOptions) {
    super(options);
    this._httpOptions = httpOptions;
    this._maxRetries = options.maxRetries;
    this._retries = 0;
    this._initialOffset = httpOptions.headers.Range ? parseRange(httpOptions.headers.Range).from : 0;

    this._endListener = this._endListener.bind(this);
    this._dataListener = this._dataListener.bind(this);
    this._errorListener = this._errorListener.bind(this);

    this._bytesSoFar = 0;

    this._resDead = false;
  }

  /**
   * Inserts an http client request
   * @param {ClientRequest} res
   * @param {number} contentLength
   */
  insertRes(res, contentLength) {
    this._contentLength = contentLength;
    this.res = res;
    this._addListeners();
  }

  insertEmitter(emitter) {
    this._emiter = emitter;
    this._emiter.addFilter("error", this._errorListener);
  }

  _removeListeners() {
    this.res.removeListener("data", this._dataListener);
    this.res.removeListener("end", this._endListener);
    this.res.removeListener("error", this._errorListener);
    if (this._currentRequest) {
      this._currentRequest.removeListener("error", this._errorListener);
    }
  }

  _addListeners() {
    this.res.on("data", this._dataListener);
    this.res.on("end", this._endListener);
    this.res.on("error", this._errorListener);
  }

  /**
   *
   * @param error
   * @returns {boolean}
   * @private
   */
  _errorListener(error) {
    console.error("Caught", error.toString());
    if (this.res) {
      this._removeListeners();
    }
    if (this._bytesSoFar + this._initialOffset > this._contentLength) {
      this._endListener();
      return true;
    }
    if (error.toString() !== "Error: read ECONNRESET") return true;
    if (this._retries + 1 > this._maxRetries) {
      this._endListener();
      return true;
    }
    let resolveRes;
    this._resDead = new Promise((resolve, reject) => {
      resolveRes = resolve;
    });
    this._httpOptions.headers.Range = `bytes=${this._bytesSoFar + this._initialOffset}-`;
    // console.log("re-requesting", this._httpOptions);
    this._retries += 1;
    this._currentRequest = https.get(this._httpOptions,
      (res) => {
        this.res = res;
        this._emiter.bindTo(res);
        this._addListeners();
        this._resDead = false;
        // console.log("New Res");
        resolveRes(res);
      }
    );
    this._currentRequest.on("error", this._errorListener);
    return false;
  }

  _endListener() {
    // console.log("End fired");
    this.push(null);
    this._removeListeners();
  }

  _dataListener(data) {
    if (this._resDead) return;
    this._bytesSoFar += data.length;
    // console.log(this._bytesSoFar, data);
    if (!this.push(data)) {
      // console.log("Paused data input");
      this.res.pause();
    }
  }

  _read(size) {
    // console.log(size);
    if (this._resDead) {
      this._resDead.then(() => {
        this.res.read(size);
      }).catch(() => {
      });
    } else {
      this.res.read(size);
    }
  }
}

streamResume.request = function (options, callback) {
  let requestOptions = {};
  if (typeof options === "string") {
    Object.assign(requestOptions, url.parse(options));
  } else {
    Object.assign(requestOptions, options);
  }
  if (!requestOptions.hasOwnProperty("headers")) {
    requestOptions.headers = {};
  }
  if (!requestOptions.hasOwnProperty("maxRetries")) {
    requestOptions.maxRetries = 3;
  }
  let outputStream = new OutputStream({}, requestOptions);
  // console.log(requestOptions);
  let newCallback = (res) => {
    // console.log(`HEADERS: ${res.headers["content-length"]}`);
    outputStream.insertRes(res, res.headers["content-length"]);
    callback(outputStream);
  };
  let emitter = new ResSubstitute(https.request(options, newCallback));
  outputStream.insertEmitter(emitter);
  return emitter;
};

streamResume.get = function (options, callback) {
  let req = streamResume.request(options, callback);
  req.end();
  return req;
};

function parseRange(text) {
  let from = "";
  let to = "";
  let mode = 0;
  for (let char of text) {
    if (char === "=") {
      mode = 1;
    } else if (char === "-") {
      mode = 2
    } else if (mode === 1) {
      from += char;
    } else if (mode === 2) {
      to += char
    }
  }
  return {from: parseInt(from), to: parseInt(to)}
}

module.exports = streamResume;

/*
 streamResume.request("url here",
 (res) => {
 setInterval(() => {
 console.log(res.read(1000))
 }, 100);
 console.log(res)
 }
 );
 */