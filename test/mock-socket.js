var EEProto = require("events").EventEmitter.prototype;
var sinon = require("sinon");
var inspect = require("util").inspect;
var format = require("util").format;
var assert = require("assert");

var intoPropertyDescriptors = function (object) {
    Object.keys(object).forEach(function (key) {
        object[key] = { value: object[key] };
    });

    return object;
};

// pad to 7 characters (e.g. length("timeout"))
var pad = function (str) {
    return ("      " + str).slice(-9);
};

var MockSocket = module.exports = function MockSocket (baselogfn) {
    var logfn = function () {
        var args = Array.prototype.slice.call(arguments);
        args.unshift("MockSocket");
        baselogfn.apply(null, args);
    };

    var connecting = false;
    var ended = false;

    return Object.create(EEProto, intoPropertyDescriptors({
        connect : sinon.spy(function () {
            connecting = true;
        }),

        write: sinon.spy(function (out) {
            out = out.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
            logfn(format("[WRITE]           '%s'", out));

            if (ended) {
                throw new Error("Write After End");
            }
        }),

        end:  function () { 
            this.emit("close");
            ended = true;
        },

        setNoDelay: sinon.spy(),
        setEncoding: sinon.spy(),

        // Spying on Event Emitter methods.
        emit: function (message, data) {
            var datastr = data === undefined ? "no-data" : inspect(data);
            logfn(format(" [EMIT] %s %s", pad(message), datastr));
            EEProto.emit.apply(this, arguments);
        },

        on: function (message, fn) {
            logfn(format("   [ON] %s %s", pad(message), fn.name));
            EEProto.on.apply(this, arguments);
        },

        removeListener: function (message, fn) {
            logfn(format("  [OFF] %s %s", pad(message), fn.name));
            EEProto.removeListener.apply(this, arguments);
        },

        // Only to be called by test code.
        acceptConnect: function () {
            assert(connecting === true);
            connecting = false;
            this.emit("connect");
        },

        acceptData: function (data) {
            this.emit("data", data);
        }
    }));
};