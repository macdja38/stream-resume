/**
 * Created by macdja38 on 2017-03-15.
 */
"use strict";

let https = require("https");
let url = require("url");
let stream = require("stream");
let Readable = stream.Readable;

let streamResume = {};
Object.assign(streamResume, https);
let file = require("fs").createWriteStream('file.webm');

// let longjohn = require("longjohn");

class OutputStream extends Readable {
  constructor(options, httpOptions) {
    super(options);
    this._httpOptions = httpOptions;

    this._endListener = this._endListener.bind(this);
    this._dataListener = this._dataListener.bind(this);
    this._errorListener = this._errorListener.bind(this);
  }

  insertRes(res) {
    this.res = res;
    this._addListeners();
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

  _errorListener(error) {
    console.error("Caught", error);
    this._removeListeners();
    this._currentRequest = https.get(this._httpOptions,
      (res) => {
        this.res = res;
        this._addListeners();
        console.log(res);
      }
    );
    this._currentRequest.on("error", this._errorListener);
  }

  _endListener() {
    this.push(null);
    this._removeListeners();
  }

  _dataListener(data) {
    if (!this.push(data)) {
      this.res.pause();
    }
  }

  _read(size) {
    console.log(size);
    this.res.read(size);
  }
}

streamResume.request = function (options, callback) {
  let requestOptions = {};
  if (typeof options === "string") {
    Object.assign(requestOptions, url.parse(options));
  } else {
    Object.assign(requestOptions, options);
  }
  requestOptions.method = "GET";
  let outputStream = new OutputStream({}, requestOptions);
  console.log(requestOptions);
  let newCallback = (res) => {
    console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
    outputStream.insertRes(res);
    callback(outputStream);
  };
  return https.get(options, newCallback).once("error", outputStream._errorListener);
};

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