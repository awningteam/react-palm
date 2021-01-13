'use strict';

// Object.defineProperty(exports, '__esModule', {
//   value: true,
// });
exports._run = _run;
exports.fromPromise = fromPromise;
exports.fromPromiseWithProgress = fromPromiseWithProgress;
exports.fromCallback = fromCallback;
exports.taskCreator_ = taskCreator_;
exports.reportTasksForTesting = reportTasksForTesting;
exports.all = all;
exports.allSettled = allSettled;

// A task that either returns, or errors
// A function that does some side-effect when run.
// A function that runs an effector for some environment.
// In test, we provide one that doesn't call the effectful
// function, instead providing a mock response.
// Private API for running a task. Do not use this directly.
// We need this because Task is an opaque type, and we
// hide `.run` outside this file.
function _run(task, fnApplication, success, error, context) {
  if (typeof task.run !== 'function') {
    throw new Error('Attempted to run something that is not a task.');
  }

  return task.run(fnApplication, success, error, context);
}
/*
 * A function that takes some Arg and returns a new task.
 */

/**
 * ## `Task.fromCallback`
 * Returns a task-creator from a function that returns a promise.
 *
 * `arg => Promise<string[]>` -> `arg => Task<string[]>`.
 *
 * Uses the second arg as a label for debugging.
 */
function fromPromise(fn, label) {
  var creator = function creator(outbound) {
    return taskCreator_(
      function (success, error) {
        return fn(outbound).then(success, error);
      },
      outbound,
      label
    );
  };

  creator.type = label;
  return creator;
}

var noop = function noop() {};
/**
 * ## `Task.fromCallbackWithProgress`
 * Returns a task-creator from a function that returns a promise.
 *
 * `({arg, onProgress}) => Promise<string[]>` -> `({arg, onProgress}) => Task<string[]>`.
 *
 * Uses the second arg as a label for debugging.
 */

function fromPromiseWithProgress(fn, label) {
  var creator = function creator(_ref) {
    var arg = _ref.arg,
      onProgress = _ref.onProgress;
    var task = taskCreator_(
      function (success, error, context) {
        return fn({
          arg: arg,
          onProgress:
            (context
              ? function (v) {
                  return context.onProgress(onProgress(v));
                }
              : noop) || noop,
        }).then(success, error);
      },
      {
        arg: arg,
        onProgress: onProgress,
      },
      label
    );
    return task;
  };

  creator.type = label;
  return creator;
}
/**
 * `Task.fromCallback`
 *
 * Turn a node-style callback function:
 *     `(arg, cb: (err, res) => void) => void`)
 * into a task creator of the same type.
 *
 * Uses the second arg as a label for debugging.
 */

function fromCallback(fn, label) {
  var creator = function creator(outbound) {
    return taskCreator_(
      function (success, error) {
        return fn(outbound, function (err, result) {
          return err ? error(err) : success(result);
        });
      },
      outbound,
      label
    );
  };

  creator.type = label;
  return creator;
}

/*
 * This is the private constructor for creating a Task object. End users
 * probably want to use `Task.fromCallback` or `task.fromPromise`.
 * It adds instrumentation to the effector, and also attaches some info
 * useful for making assertions in test.
 */
function taskCreator_(effector, payload, label) {
  // Instrument the task with reporting
  var effectorPrime = function effectorPrime(success, error, context) {
    reportEffects('start', newTask, payload);
    return effector(
      function (result) {
        reportEffects('success', newTask, result);
        return success(result);
      },
      function (reason) {
        reportEffects('error', newTask, reason);
        return error(reason);
      },
      context
    );
  };

  effectorPrime.payload = payload;
  effectorPrime.type = label;

  var newTask = _task(
    payload,
    function (runEffect, success, error, context) {
      return runEffect(effectorPrime, success, error, context);
    },
    label
  );

  return newTask;
} // Internal task constructor.
// Note that payload is only kept around for testing/debugging purposes
// It should not be introspected outside of test

function _task(payload, next, label) {
  return {
    label: label,
    type: label,
    payload: payload,

    /*
     * Given the effector (or a mock), kicks off the task.
     * You (the end user) probably don't need to call this
     * directly. The middleware should handle it.
     */
    run: next,

    /*
     * Public Task Methods
     */
    chain: chain,
    map: map,
    bimap: bimap,
  };

  function map(successTransform) {
    return _task(
      payload,
      function (runEffect, success, error, context) {
        return next(
          runEffect,
          function (result) {
            return success(successTransform(result));
          },
          error,
          context
        );
      },
      label
    );
  }

  function bimap(successTransform, errorTransform) {
    return _task(
      payload,
      function (runEffect, success, error, context) {
        return next(
          runEffect,
          function (result) {
            return success(successTransform(result));
          },
          function (reason) {
            return error(errorTransform(reason));
          },
          context
        );
      },
      label
    );
  }

  function chain(chainTransform) {
    return _task(
      payload,
      function (runEffect, success, error, context) {
        return next(
          runEffect,
          function (result) {
            var chainTask = chainTransform(result);
            return chainTask.run(runEffect, success, error, context);
          },
          error,
          context
        );
      },
      'Chain('.concat(label, ')')
    );
  }
}
/*
 * Record the inputs/outputs of all tasks, for debugging or inspecting.
 * This feature should not be used to implement runtime behavior.
 */

var reportEffects = function reportEffects(event, task, payload) {};
/**
 * ## `reportTasksForTesting`
 *
 * Takes a function that is called whenever a task is dispatched,
 * returns, or errors.
 *
 * Note that only one function can be registered with this hook.
 * The last provided function is the one that takes effect.
 */

function reportTasksForTesting(fn) {
  reportEffects = fn;
} // type level utils functions needed for Task.all

/*
 * ## `Task.all`
 *
 * Given an array of Tasks, returns a new task that runs all the effects
 * of the original in parallel, with an array result where each element
 * corresponds to a task.
 *
 * Acts like `Promise.all`.
 */
function all(tasks) {
  return _task(
    tasks.map(function (task) {
      return task.payload;
    }),
    function (runEffect, success, error, context) {
      if (tasks.length === 0) {
        return success([]);
      }

      var accumulated = Array(tasks.length);
      var complete = 0;
      var errorValue = null;

      function allSuccess(index) {
        return function (value) {
          if (errorValue) {
            return;
          }

          accumulated[index] = value;
          complete += 1;

          if (complete === tasks.length) {
            return success(accumulated);
          }
        };
      }

      function anyError(err) {
        if (!err) {
          return;
        }

        errorValue = err;
        return error(errorValue);
      }

      return Promise.all(
        tasks.map(function (task, index) {
          return task.run(runEffect, allSuccess(index), anyError, context);
        })
      );
    },
    'Task.all(' +
      tasks
        .map(function (_ref2) {
          var type = _ref2.type;
          return type;
        })
        .join(', ') +
      ')'
  );
}

/*
 * ## `Task.allSettled`
 *
 * Given an array of Tasks, returns a new task that runs all the effects
 * of the original in parallel, with an array result where each element
 * corresponds to a task.
 *
 * Acts like `Promise.allSettled`.
 */
function allSettled(tasks) {
  return _task(
    tasks.map(function (task) {
      return task.payload;
    }),
    function (runEffect, success, error, context) {
      if (tasks.length === 0) {
        return success([]);
      }

      var accumulated = Array(tasks.length);
      var complete = 0;

      function onOneTaskFinish(index, status) {
        return function (value) {
          accumulated[index] = {
            status: status,
            value: value,
          };
          complete += 1;

          if (complete === tasks.length) {
            return success(accumulated);
          }
        };
      }

      return Promise.allSettled(
        tasks.map(function (task, index) {
          return task.run(
            runEffect,
            onOneTaskFinish(index, 'fulfilled'),
            onOneTaskFinish(index, 'rejected'),
            context
          );
        })
      );
    },
    'Task.allSettled(' +
      tasks
        .map(function (_ref3) {
          var type = _ref3.type;
          return type;
        })
        .join(', ') +
      ')'
  );
}

exports.taskCreator = taskCreator;

/**
 * # Legacy APIs
 *
 * These are provided as a stop-gap to avoid breaking changes.
 * They are currently re-exported by default, but that will
 * probaby change in the future.
 */

/**
 * ## `taskCreator`
 *
 * Given a function: `(arg, successCb, errorCb) => any`
 * Returns a task creator function: `(arg) => Task`.
 *
 * This API is a bit cumbersome.
 * You probably want to use `Task.fromCallback` or `Task.fromPromise` instead,
 * which do the same thing but with less boilerplate.
 */
function taskCreator(fn, label) {
  var creator = function creator(outbound) {
    return (0, _core.taskCreator_)(
      function (success, error) {
        return fn(outbound, success, error);
      },
      outbound,
      label
    );
  };

  creator.type = label;
  return creator;
}

exports.getGlobalTaskQueue = getGlobalTaskQueue;
exports.updateGlobalTaskQueue = updateGlobalTaskQueue;
exports.getLastWithTaskCall = getLastWithTaskCall;
exports.setLastWithTaskCall = setLastWithTaskCall;
exports.clearLastWithTaskCall = clearLastWithTaskCall;

/**
 * For apps using Redux, we provide `withTasks` for `lift`ing tasks
 * out of a "sub-reducer" into the top-level app's space. This helps remove
 * extra plumbing that would potentially add boilerplate.
 *
 * To support this, we create a global record to collect tasks (and debug info).
 * Although this queue is global, we reset it between dispatches to the store.
 * You can think of this queue as a "thread local."
 *
 * We also want to make sure that if multiple versions of react-palm are loaded,
 * that we're able to have just a single queue.
 *
 * End users should not use any of these APIs directly. Instead, use the
 * redux middleware.
 */
// We attach an object to `window` or `global` with this name.
var GLOBAL_TASK_STATE = '___GLOBAL_TASK_STATE_e3b0c442';
// Try to determine the object representing the global namespace.
var GLOBAL = typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : {};

if (typeof GLOBAL[GLOBAL_TASK_STATE] !== 'undefined') {
  console.warn('More than one copy of react-palm was loaded. This may cause problems.');
} else {
  Object.defineProperty(GLOBAL, GLOBAL_TASK_STATE, {
    ennumerable: false,
    value: {
      tasks: [],
      lastWithTaskCall: null,
    },
  });
}
/*
 * Getters and setters used by test utils and redux middlware.
 * Again, you probably don't need to ever use these directly.
 */

function getGlobalTaskQueue() {
  return GLOBAL[GLOBAL_TASK_STATE].tasks;
}

function updateGlobalTaskQueue(newQueue) {
  GLOBAL[GLOBAL_TASK_STATE].tasks = newQueue;
}

function getLastWithTaskCall() {
  return GLOBAL[GLOBAL_TASK_STATE].lastWithTaskCall;
}

function setLastWithTaskCall(last) {
  GLOBAL[GLOBAL_TASK_STATE].lastWithTaskCall = last;
}

function clearLastWithTaskCall() {
  GLOBAL[GLOBAL_TASK_STATE].lastWithTaskCall = null;
}

exports.withTasks = withTasks;
exports.disableStackCapturing = disableStackCapturing;
exports.withTask = exports.taskMiddleware = void 0;

var CACHED_PROMISE = Promise.resolve();

var makeDispatchAsync = function makeDispatchAsync(dispatch) {
  return function (action) {
    return CACHED_PROMISE.then(function () {
      return dispatch(action);
    });
  };
}; // The way webpack does hot-reloading seems to break the checks we
// do against the stack trace.

var WEBPACK_HOT_RELOAD_ENABLED = Boolean(module.hot);
var enableStackCapture = !WEBPACK_HOT_RELOAD_ENABLED;
var IMPROPER_TASK_USAGE = 'Tasks should not be added outside of reducers.';
/**
 * You need to install this middleware for tasks to have their handlers run.
 *
 * You probably do not want to use this middleware within your test environment.
 * Instead, use `drainTasksForTesting` to retrieve and make assertions about them.
 *
 * This middleware changes the behavior of `store.dispatch` to return a promise.
 * That promise will resolve when all pending tasks for that call to `dispatch`
 * have finished (including calls transitively enqueued by tasks that dispatch actions).
 */

var taskMiddleware = function taskMiddleware(store) {
  return function (next) {
    return function (action) {
      // If we begin a call to dispatch with tasks still in the queue,
      // we have a problem.
      if (enableStackCapture && (0, _global.getGlobalTaskQueue)().length > 0) {
        var err = (0, _global.getLastWithTaskCall)();
        (0, _global.clearLastWithTaskCall)();
        throw err;
      }

      next(action);
      var dispatch = makeDispatchAsync(store.dispatch);

      if ((0, _global.getGlobalTaskQueue)().length > 0) {
        var taskResolutions = (0, _global.getGlobalTaskQueue)().map(runTaskActual(dispatch));
        (0, _global.updateGlobalTaskQueue)([]);
        (0, _global.clearLastWithTaskCall)();
        return Promise.all(taskResolutions);
      }

      return CACHED_PROMISE;
    };
  };
}; // Given a function that accepts two continuations (one for success, one for error),
// call the function supplying the provided continuations.

exports.taskMiddleware = taskMiddleware;

var biApply = function biApply(f, s, e, c) {
  return f(s, e, c);
}; // Run the task with the proper effect

function runTaskActual(dispatch) {
  return function (task) {
    // unsafe coerce this because it doesn't matter
    return (0, _core._run)(task, biApply, dispatch, dispatch, {
      onProgress: dispatch,
    });
  };
}
/**
 * Use this function in your reducer to add tasks to an action handler.
 * The task will be lifted up to the top of your app. Returns the same
 * state object passed into it.
 */

function withTasks(state, tasks) {
  if (enableStackCapture && !(0, _global.getLastWithTaskCall)()) {
    (0, _global.setLastWithTaskCall)(trace(IMPROPER_TASK_USAGE));
  }

  (0, _global.updateGlobalTaskQueue)(
    (0, _global.getGlobalTaskQueue)().concat(tasks instanceof Array ? tasks : [tasks])
  );
  return state;
}
/**
 * A helpful alias for providing just one task.
 * `withTask(state, task1)` is the same as `withTasks(state, [task1])`.
 */

var withTask = withTasks;
/**
 * In order to make it easy to track down incorrect uses for `withTask`, we capture exception
 * objects for every call to withTask. This has some performance overhead, so you'll
 * probably want to disable it in production.
 *
 * Note that if you're using Webpack's hot reload, we disable this functionality by default.
 */

exports.withTask = withTask;

function disableStackCapturing() {
  enableStackCapture = false;
}
/*
 * Helpers
 */

function trace(message) {
  try {
    throw new Error(message);
  } catch (e) {
    return e;
  }
}

exports.succeedTaskInTest = succeedTaskInTest;
exports.errorTaskInTest = errorTaskInTest;
exports.simulateTask = simulateTask;
exports.succeedTaskWithValues = succeedTaskWithValues;
exports.drainTasksForTesting = drainTasksForTesting;

/**
 * Get the resulting value of a task, providing the given value as the inbound result.
 * If your task uses `.chain` or `Task.all`, you probably want to use `simulateTask`
 * or `succeedTaskWithValues` instead.
 */
function succeedTaskInTest(someTask, value) {
  return _runAndCaptureResult(someTask, function (_, s, _e) {
    return s(value);
  });
}
/**
 * Get the failure value of a task, providing the given value as the inbound error.
 *
 * If your task uses `.chain` or `Task.all`, you probably want to use `simulateTask`
 * instead.
 */

function errorTaskInTest(someTask, value) {
  return _runAndCaptureResult(someTask, function (_, _s, e) {
    return e(value);
  });
}
/**
 * Run a task, using `simulator` for bi-application. `simulator` recieves:
 *
 * 1. an object representing a side-effect with `payload` and `type`.
 * 2. a success handler to call with a mocked response.
 * 3. an error handler to call with a mocked out response.
 *
 * A simulator might be called more than once in the case of `Task.all`
 * or `task.chain`.
 */

function simulateTask(someTask, simulator) {
  return _runAndCaptureResult(someTask, simulator);
}
/**
 * Given some task, and array of values,
 */

function succeedTaskWithValues(someTask, values) {
  var index = 0;
  return _runAndCaptureResult(someTask, function (_, s) {
    if (index >= values.length) {
      throw new Error('Not enough values were provided!');
    }

    var returned = s(values[index]);
    index += 1;
    return returned;
  });
}
/**
 * This function should only be used in test environments to make assertions about
 * tasks as part of the test. Application code should not be mucking around with
 * the list of tasks.
 *
 * If you want to display information about tasks in your component,
 * add that information to your state tree when you create the task.
 *
 * If you want to get access to the current tasks, do so by returning the
 * tasks from helpers, and inspecting them before passing them to `withTask`.
 */

function drainTasksForTesting() {
  var drained = (0, _global.getGlobalTaskQueue)();
  (0, _global.updateGlobalTaskQueue)([]);
  (0, _global.clearLastWithTaskCall)();
  return drained;
}

function _runAndCaptureResult(someTask, simulator) {
  var returned;

  var setReturned = function setReturned(val) {
    returned = val;
  };

  (0, _core._run)(someTask, simulator, setReturned, setReturned);

  if (typeof returned === 'undefined') {
    throw new Error('A success or error handler was never called!');
  }

  return returned;
}

var _exportNames = {
  reportTasksForTesting: true,
  taskCreator: true,
  taskMiddleware: true,
  withTask: true,
  withTasks: true,
  disableStackCapturing: true,
};
Object.defineProperty(exports, 'reportTasksForTesting', {
  enumerable: true,
  get: function get() {
    return _core.reportTasksForTesting;
  },
});
Object.defineProperty(exports, 'taskCreator', {
  enumerable: true,
  get: function get() {
    return _legacy.taskCreator;
  },
});
Object.defineProperty(exports, 'taskMiddleware', {
  enumerable: true,
  get: function get() {
    return _redux.taskMiddleware;
  },
});
Object.defineProperty(exports, 'withTask', {
  enumerable: true,
  get: function get() {
    return _redux.withTask;
  },
});
Object.defineProperty(exports, 'withTasks', {
  enumerable: true,
  get: function get() {
    return _redux.withTasks;
  },
});
Object.defineProperty(exports, 'disableStackCapturing', {
  enumerable: true,
  get: function get() {
    return _redux.disableStackCapturing;
  },
});
exports.default = void 0;

Object.keys(_testUtils).forEach(function (key) {
  if (key === 'default' || key === '__esModule') return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _testUtils[key];
    },
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
  fromPromiseWithProgress: _core.fromPromiseWithProgress,
};
exports.default = _default;
