/**
 * Created by macdja38 on 2017-03-20.
 */

const RebindableEmitter = require("../index.js").RebindableEmitter;
const EventEmitter = require("events").EventEmitter;

test("test binding event to original emitter", () => {
  let vanillaEmitter1 = new EventEmitter();
  let emitter = new RebindableEmitter(vanillaEmitter1);
  const mockfn = jest.fn();
  emitter.on("thing", mockfn);
  vanillaEmitter1.emit("thing", "right");
  expect(mockfn).toHaveBeenCalledTimes(1);
  expect(mockfn).toHaveBeenCalledWith("right");
});

test("test rebinding emitter", () => {
  let vanillaEmitter1 = new EventEmitter();
  let vanillaEmitter2 = new EventEmitter();
  let emitter = new RebindableEmitter(vanillaEmitter1);
  const mockfn = jest.fn();
  emitter.on("thing", mockfn);
  emitter.bindTo(vanillaEmitter2);
  vanillaEmitter1.emit("thing", "wrong");
  expect(mockfn).toHaveBeenCalledTimes(0);
  vanillaEmitter2.emit("thing", "right");
  expect(mockfn).toHaveBeenCalledTimes(1);
  expect(mockfn).toHaveBeenCalledWith("right");
});

test("test filter function before filter add, filter out", () => {
  let vanillaEmitter1 = new EventEmitter();
  let emitter = new RebindableEmitter(vanillaEmitter1);
  const mockfn = jest.fn();
  emitter.on("thing", mockfn);
  emitter.addFilter("thing", () => {
    return false;
  });
  vanillaEmitter1.emit("thing", "right");
  expect(mockfn).toHaveBeenCalledTimes(0);
});

test("test filter function before filter add, pass through", () => {
  let vanillaEmitter1 = new EventEmitter();
  let emitter = new RebindableEmitter(vanillaEmitter1);
  const mockfn = jest.fn();
  emitter.on("thing", mockfn);
  emitter.addFilter("thing", () => {
    return true;
  });
  vanillaEmitter1.emit("thing", "right");
  expect(mockfn).toHaveBeenCalledTimes(1);
  expect(mockfn).toHaveBeenCalledWith("right");
});

test("test filter function binding after filter add, filter out", () => {
  let vanillaEmitter1 = new EventEmitter();
  let emitter = new RebindableEmitter(vanillaEmitter1);
  const mockfn = jest.fn();
  emitter.addFilter("thing", () => {
    return false;
  });
  emitter.on("thing", mockfn);
  vanillaEmitter1.emit("thing", "right");
  expect(mockfn).toHaveBeenCalledTimes(0);
});

test("test filter function binding after filter add, pass through", () => {
  let vanillaEmitter1 = new EventEmitter();
  let emitter = new RebindableEmitter(vanillaEmitter1);
  const mockfn = jest.fn();
  emitter.addFilter("thing", () => {
    return true;
  });
  emitter.on("thing", mockfn);
  vanillaEmitter1.emit("thing", "right");
  expect(mockfn).toHaveBeenCalledTimes(1);
  expect(mockfn).toHaveBeenCalledWith("right");
});