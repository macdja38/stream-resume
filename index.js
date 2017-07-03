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
  /**
   * Rebindable event emitter used as the base for the return object of http.get / http.request
   * @param {EventEmitter} currentEmitter initial event emitter to bind to.
   * @private
   */
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

  /**
   * Rebinds to a new event emitter
   * @param {EventEmitter} emitter
   */
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

  /**
   * Adds a filter function to an event, filter function will decide if event should be emitted or not.
   * If the filter function returns true event is emitted anything else event will stop.
   * @param {string} name name of event to limit
   * @param {Function} filterFunction function to call with event.
   */
  addFilter(name, filterFunction) {
    if (!this._filteredEvents.includes(name)) {
      this._filteredEvents.push(name);
    }
    this._currentEmitter.removeAllListeners(name);
    this._currentEmitter.on(name, (data) => {
      if (filterFunction(data) === true) {
        this.emit(name, data)
      }
    });
  }

  /**
   * Called on a new listener being added
   * @param {string} name
   * @param {Function} listener
   * @private
   */
  _onNewListener(name, listener) {
    if (listener === this._onNewListener) return;
    if (!this._activeEvents.includes(name)) {
      this._activeEvents.push(name);
    }
    if (this._filteredEvents.includes(name)) return;
    this._currentEmitter.on(name, listener);
  }

  /**
   * Called when a listener is removed
   * @param {string} name
   * @param {Function} listener
   * @private
   */
  _onRemoveListener(name, listener) {
    if (this._activeEvents.includes(name) && this.listenerCount(name) < 2) {
      this._activeEvents = this._activeEvents.splice(this._activeEvents.indexOf(name), 1);
    }
    this._currentEmitter.removeListener(name, listener);
  }
}

class ResSubstitute extends RebindableEmitter {
  /**
   * Extends the RebindableEvent Emitter
   * @param {ClientRequest} res
   * @private
   */
  constructor(res) {
    super(res);
    this._res = res;
  }

  /**
   * Calls end on the client request
   */
  end() {
    this._res.end();
  }
}

class OutputStream extends Readable {
  /**
   * Stream returned in the callback of the request
   * @param {Object} options stream options
   * @param {Object} httpOptions options used to make the http request
   */
  constructor(options, httpOptions) {
    super(options);
    this._httpOptions = httpOptions;
    this._maxRetries = httpOptions.maxRetries;
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

  /**
   * Inserts an event emitter
   * @param {ResSubstitute} emitter
   */
  insertEmitter(emitter) {
    this._emitter = emitter;
    this._emitter.addFilter("error", this._errorListener);
  }

  /**
   * Removes all the listeners from the current request
   * @private
   */
  _removeListeners() {
    // console.log("removing Listeners");
    this.res.removeListener("data", this._dataListener);
    this.res.removeListener("end", this._endListener);
    this.res.removeListener("error", this._errorListener);
    if (this._currentRequest) {
      this._currentRequest.removeListener("error", this._errorListener);
    }
  }

  /**
   * Binds the listeners to the current request
   * @private
   */
  _addListeners() {
    // console.log("adding listeners");
    this.res.on("data", this._dataListener);
    this.res.on("end", this._endListener);
    this.res.on("error", this._errorListener);
  }

  /**
   * Listens for errors and restarts the request
   * @param error
   * @returns {boolean}
   * @private
   */
  _errorListener(error) {
    // console.error("Caught", error.toString());
    if (this.res) {
      this._removeListeners();
    }
    if (this._bytesSoFar + this._initialOffset >= this._contentLength) {
      this._endListener();
      return true;
    }
    if (error.toString() !== "Error: read ECONNRESET") {
      this._endListener();
      return true;
    }
    // console.log(this._retries, this._maxRetries);
    return this._retry(error);
  }

  /**
   * Starts a retry cycle (or ends if max retries has been met)
   * @returns {boolean} true if retry was canceled
   * @private
   */
  _retry(error) {
    // console.log("retrying due to ", error);
    this._retries += 1;
    if (this._retries > this._maxRetries) {
      this._endListener();
      return true;
    }
    this._emitter.emit("warn", error);
    let resolveRes;
    this._resDead = new Promise((resolve) => {
      resolveRes = resolve;
    });
    this._httpOptions.headers.Range = `bytes=${this._bytesSoFar + this._initialOffset}-`;
    // console.log("re-requesting", this._httpOptions);
    this._currentRequest = https.get(this._httpOptions,
      (res) => {
        this.res = res;
        this._emitter.bindTo(res);
        this._addListeners();
        this._resDead = false;
        // console.log("New Res");
        resolveRes(res);
      }
    );
    this._currentRequest.on("error", this._errorListener);
    return false;
  }

  /**
   * Handles the stream ending
   * @private
   */
  _endListener() {
    // console.log("End fired");
    this.push(null);
    this._removeListeners();
  }

  /**
   * Handles receiving data from the stream, counting the length and buffering it.
   * @param data
   * @private
   */
  _dataListener(data) {
    if (this._resDead) return;

    // retry if not all data has been fetched
    if (data == null && (this._bytesSoFar + this._initialOffset < this._contentLength)) {
      this._retry(new Error("received null data before end"));
      return true;
    }

    this._bytesSoFar += data.length;
    // console.log(this._bytesSoFar, data);
    if (!this.push(data)) {
      // console.log("Paused data input");
      this.res.pause();
    }
  }

  //noinspection JSUnusedGlobalSymbols
  /**
   * Is called by the event emitter when it needs more data, asks the current request for the data
   * @param {number} size
   * @private
   */
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

/**
 * Makes a request where econResets are handled automatically. Calls https.request internally.
 * Similar to https.request (currently always uses https.get for subsequent requests, not recommended for use currently)
 * @param {Object|string} options options object or a string, if a string will be parsed using url.parse()
 * @param {number} [options.maxRetries=3] retry limit
 * @param {function} callback
 * @returns {ResSubstitute}
 */
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

/**
 * Makes a request where econResets are handled automatically. Calls https.request internally.
 * @param {Object|string} options options object or a string, if a string will be parsed using url.parse()
 * @param {number} [options.maxRetries=3] retry limit
 * @param {function} callback
 * @returns {ResSubstitute}
 */
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

module.exports.RebindableEmitter = RebindableEmitter;

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