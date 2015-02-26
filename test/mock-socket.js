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

var MockSocket = module.exports = function MockSocket (baselogfn) {
    var logfn = function () {
        var args = Array.prototype.slice.call(arguments);
        args.unshift("MockSocket");
        baselogfn.apply(null, args);
    };

    var connecting = false;

    return Object.create(EEProto, intoPropertyDescriptors({
        connect : sinon.spy(function () {
            connecting = true;
        }),

        write: sinon.spy(function (out) {
            logfn("writing", format("\"%s\"", out.replace(/\r/g, "\\r").replace(/\n/g, "\\n")));
        }),

        end:  function () { this.emit("close"); },
        setNoDelay: sinon.spy(),
        setEncoding: sinon.spy(),

        // Spying on Event Emitter methods.
        emit: function (message, data) {
            var datastr = data === undefined ? "no-data" : inspect(data);
            logfn("emitting", format("\"%s\"", message), datastr);
            EEProto.emit.apply(this, arguments);
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