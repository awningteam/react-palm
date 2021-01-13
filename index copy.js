"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  reportTasksForTesting: true,
  taskCreator: true,
  taskMiddleware: true,
  withTask: true,
  withTasks: true,
  disableStackCapturing: true
};
Object.defineProperty(exports, "reportTasksForTesting", {
  enumerable: true,
  get: function get() {
    return _core.reportTasksForTesting;
  }
});
Object.defineProperty(exports, "taskCreator", {
  enumerable: true,
  get: function get() {
    return _legacy.taskCreator;
  }
});
Object.defineProperty(exports, "taskMiddleware", {
  enumerable: true,
  get: function get() {
    return _redux.taskMiddleware;
  }
});
Object.defineProperty(exports, "withTask", {
  enumerable: true,
  get: function get() {
    return _redux.withTask;
  }
});
Object.defineProperty(exports, "withTasks", {
  enumerable: true,
  get: function get() {
    return _redux.withTasks;
  }
});
Object.defineProperty(exports, "disableStackCapturing", {
  enumerable: true,
  get: function get() {
    return _redux.disableStackCapturing;
  }
});
exports.default = void 0;

var _core = require("./core");

var _legacy = require("./legacy");

var _redux = require("./redux");

var _testUtils = require("./test-utils");

Object.keys(_testUtils).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _testUtils[key];
    }
  });
});
// In the future, test utils will not be exported from
// this main bundle
// This default export provides a nice alias:
// ```
// import Task from 'react-palm/tasks';
// Task.all([...])
// ```
var _default = {
  all: _core.all,
  allSettled: _core.allSettled,
  fromCallback: _core.fromCallback,
  fromPromise: _core.fromPromise,
  fromPromiseWithProgress: _core.fromPromiseWithProgress
};
exports.default = _default;