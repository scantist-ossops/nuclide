'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.BreakpointStore = undefined;

var _asyncToGenerator = _interopRequireDefault(require('async-to-generator'));

var _utils;

function _load_utils() {
  return _utils = _interopRequireDefault(require('./utils'));
}

var _DbgpSocket;

function _load_DbgpSocket() {
  return _DbgpSocket = require('./DbgpSocket');
}

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * 
 */

const PAUSE_ALL_EXCEPTION_NAME = '*';
const EXCEPTION_PAUSE_STATE_ALL = 'all';

// Stores breakpoints and connections.
//
// Added breakpoints are given a unique id and are added to all available connections.
//
// Breakpoints may be added before any connections.
//
// Care is taken to ensure that operations are atomic in the face of async turns.
// Specifically, removing a breakpoint removes it from all connection's maps
// before returning.
class BreakpointStore {
  // Client visible breakpoint map from
  // chrome breakpoint id to Breakpoint object.
  constructor() {
    this._breakpointCount = 0;
    this._connections = new Map();
    this._breakpoints = new Map();
    this._pauseAllExceptionBreakpointId = null;
  }
  // For each connection a map from the chrome's breakpoint id to
  // the Connection's xdebug breakpoint id.


  setFileLineBreakpoint(chromeId, filename, lineNumber, conditionExpression) {
    var _this = this;

    return (0, _asyncToGenerator.default)(function* () {
      const breakpointInfo = { filename, lineNumber, conditionExpression };
      _this._breakpoints.set(chromeId, {
        chromeId,
        breakpointInfo,
        resolved: false
      });
      const breakpointPromises = Array.from(_this._connections.entries()).map((() => {
        var _ref = (0, _asyncToGenerator.default)(function* (entry) {
          const [connection, map] = entry;
          const xdebugBreakpointId = yield connection.setFileLineBreakpoint(breakpointInfo);
          map.set(chromeId, xdebugBreakpointId);
        });

        return function (_x) {
          return _ref.apply(this, arguments);
        };
      })());
      yield Promise.all(breakpointPromises);
      yield _this._updateBreakpointInfo(chromeId);
      return chromeId;
    })();
  }

  _updateBreakpointInfo(chromeId) {
    var _this2 = this;

    return (0, _asyncToGenerator.default)(function* () {
      for (const entry of _this2._connections) {
        const [connection, map] = entry;
        const xdebugBreakpointId = map.get(chromeId);

        if (!(xdebugBreakpointId != null)) {
          throw new Error('Invariant violation: "xdebugBreakpointId != null"');
        }

        const promise = connection.getBreakpoint(xdebugBreakpointId);
        const xdebugBreakpoint = yield promise; // eslint-disable-line no-await-in-loop
        _this2.updateBreakpoint(chromeId, xdebugBreakpoint);
        // Breakpoint status should be the same for all connections
        // so only need to fetch from the first connection.
        break;
      }
    })();
  }

  getBreakpoint(breakpointId) {
    return this._breakpoints.get(breakpointId);
  }

  getBreakpointIdFromConnection(connection, xdebugBreakpoint) {
    const map = this._connections.get(connection);

    if (!map) {
      throw new Error('Invariant violation: "map"');
    }

    for (const [key, value] of map) {
      if (value === xdebugBreakpoint.id) {
        return key;
      }
    }
    return null;
  }

  updateBreakpoint(chromeId, xdebugBreakpoint) {
    const breakpoint = this._breakpoints.get(chromeId);

    if (!(breakpoint != null)) {
      throw new Error('Invariant violation: "breakpoint != null"');
    }

    const { breakpointInfo } = breakpoint;
    breakpointInfo.lineNumber = xdebugBreakpoint.lineno || breakpointInfo.lineNumber;
    breakpointInfo.filename = xdebugBreakpoint.filename || breakpointInfo.filename;
    if (xdebugBreakpoint.resolved != null) {
      breakpoint.resolved = xdebugBreakpoint.resolved === 'resolved';
    } else {
      breakpoint.resolved = true;
    }
  }

  removeBreakpoint(breakpointId) {
    var _this3 = this;

    return (0, _asyncToGenerator.default)(function* () {
      _this3._breakpoints.delete(breakpointId);
      return _this3._removeBreakpointFromConnections(breakpointId);
    })();
  }

  /**
   * TODO[jeffreytan]: look into unhandled exception support.
   * Dbgp protocol does not seem to support uncaught exception handling
   * so we only support 'all' and treat all other states as 'none'.
   */
  setPauseOnExceptions(chromeId, state) {
    var _this4 = this;

    return (0, _asyncToGenerator.default)(function* () {
      if (state !== EXCEPTION_PAUSE_STATE_ALL) {
        // Try to remove any existing exception breakpoint.
        return _this4._removePauseAllExceptionBreakpointIfNeeded();
      }
      _this4._pauseAllExceptionBreakpointId = chromeId;

      const breakpointPromises = Array.from(_this4._connections.entries()).map((() => {
        var _ref2 = (0, _asyncToGenerator.default)(function* (entry) {
          const [connection, map] = entry;
          const xdebugBreakpointId = yield connection.setExceptionBreakpoint(PAUSE_ALL_EXCEPTION_NAME);
          map.set(chromeId, xdebugBreakpointId);
        });

        return function (_x2) {
          return _ref2.apply(this, arguments);
        };
      })());
      yield Promise.all(breakpointPromises);
    })();
  }

  _removePauseAllExceptionBreakpointIfNeeded() {
    var _this5 = this;

    return (0, _asyncToGenerator.default)(function* () {
      const breakpointId = _this5._pauseAllExceptionBreakpointId;
      if (breakpointId) {
        _this5._pauseAllExceptionBreakpointId = null;
        return _this5._removeBreakpointFromConnections(breakpointId);
      } else {
        // This can happen if users switch between 'none' and 'uncaught' states.
        (_utils || _load_utils()).default.log('No exception breakpoint to remove.');
        return Promise.resolve();
      }
    })();
  }

  _removeBreakpointFromConnections(breakpointId) {
    return Promise.all(Array.from(this._connections.entries()).map(entry => {
      const [connection, map] = entry;
      if (map.has(breakpointId)) {
        const connectionIdPromise = map.get(breakpointId);

        if (!(connectionIdPromise != null)) {
          throw new Error('Invariant violation: "connectionIdPromise != null"');
        }

        map.delete(breakpointId);
        // Ensure we've removed from the connection's map before awaiting.
        return (0, _asyncToGenerator.default)(function* () {
          return connection.removeBreakpoint((yield connectionIdPromise));
        })();
      } else {
        return Promise.resolve();
      }
    }));
  }

  addConnection(connection) {
    var _this6 = this;

    return (0, _asyncToGenerator.default)(function* () {
      const map = new Map();
      const breakpointPromises = Array.from(_this6._breakpoints.values()).map((() => {
        var _ref4 = (0, _asyncToGenerator.default)(function* (breakpoint) {
          const { chromeId, breakpointInfo } = breakpoint;
          const xdebugBreakpointId = yield connection.setFileLineBreakpoint(breakpointInfo);
          map.set(chromeId, xdebugBreakpointId);
        });

        return function (_x3) {
          return _ref4.apply(this, arguments);
        };
      })());
      yield Promise.all(breakpointPromises);
      if (_this6._pauseAllExceptionBreakpointId) {
        const breakpoitnId = yield connection.setExceptionBreakpoint(PAUSE_ALL_EXCEPTION_NAME);

        if (!(_this6._pauseAllExceptionBreakpointId != null)) {
          throw new Error('Invariant violation: "this._pauseAllExceptionBreakpointId != null"');
        }

        map.set(_this6._pauseAllExceptionBreakpointId, breakpoitnId);
      }
      _this6._connections.set(connection, map);
      connection.onStatus(function (status) {
        switch (status) {
          case (_DbgpSocket || _load_DbgpSocket()).ConnectionStatus.Stopping:
          case (_DbgpSocket || _load_DbgpSocket()).ConnectionStatus.Stopped:
          case (_DbgpSocket || _load_DbgpSocket()).ConnectionStatus.Error:
          case (_DbgpSocket || _load_DbgpSocket()).ConnectionStatus.End:
            _this6._removeConnection(connection);
        }
      });
    })();
  }

  _removeConnection(connection) {
    if (this._connections.has(connection)) {
      this._connections.delete(connection);
    }
  }
}
exports.BreakpointStore = BreakpointStore;