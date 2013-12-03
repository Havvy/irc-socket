/**
 *
 * IRC Socket
 *
 * Socket that connects to an IRC network and emits each line from the server.
 *
 * Send messages to server with .raw(String) method.
 */

var net = require('net');
var tls = require('tls');
var events = require('events');
var util = require('util');

 var log = function (input, msg) {
     var date = new Date();
     console.log(Date().toString() + "|" + (input ? "<-" : "->") + "|" + msg);
 };

var create = function (prototype, properties) {
    if (typeof properties == 'object') {
        var props = {};
        Object.keys(properties).forEach(function (key) {
            props[key] = { value: properties[key] };
        });
    }

    return Object.create(prototype, props);
};

var Socket = module.exports = function Socket (network, GenericSocket) {
    GenericSocket = GenericSocket || net.Socket;

    var socket = create(Socket.prototype);
    socket.port = network.port || 6667;
    socket.netname = network.server;
    socket.secure = network.secure || false;
    socket.network = network;
    socket.genericSocket = new GenericSocket();
    socket.connected = false;

    socket.setupEvents = function () {
        void function connectEvent () {
            socket.connected = true;
            socket.raw(["NICK", socket.network.nick]);
            socket.raw(["USER", socket.network.user || "user", "8 * :" + socket.network.realname]);
        }();
        
        var onData = function onData (data) {
            lines = data.split('\r\n');

            if (onData.buffer) {
                lines[0] = onData.buffer + lines[0];
                onData.buffer = null;
            }

            if (lines[lines.length - 1] !== "") {
                onData.buffer = lines.pop();
            }

            lines
            .filter(function (line) { return line !== ''; })
            .filter(function (line) {
                if (line.slice(0, 4) === 'PING') {
                    socket.raw(['PONG', line.slice(line.indexOf(':'))]);
                    return false;
                }

                return true;
            })
            .forEach(function (line) {
                log(true, line);
                socket.emit('data', line);
            });
        };

        onData.buffer = null;

        void function readyEvent () {
            var emitWhenReady = function (data) {
                if (Socket.isReady(data)) {
                    socket.emit('ready');
                }
            };

            socket.genericSocket.on('data', emitWhenReady);
            socket.on('ready', function remove () {
                socket.genericSocket.removeListener('data', emitWhenReady);
            });
        }();

        socket.genericSocket.once('close', function () {
            socket.connected = false;
        });

        socket.genericSocket.on('data', onData);
        socket.genericSocket.setEncoding('ascii');
        socket.genericSocket.setNoDelay();
    };

    return socket;
};

Socket.isReady = function (data) {
    // We are 'ready' when we get a 001 message.
    return data.split('\r\n')
    .filter(function (line) { return line !== ''; })
    .some(function (line) { return line.split(' ')[1] === '001'; });
};

Socket.prototype = create(events.EventEmitter.prototype, {
    connect : function () {
        if (this.isConnected()) {
            return;
        }

        if (this.secure) {
            this.genericSocket = tls.connect(this.port, this.netname, {rejectUnauthorized: false}, this.setupEvents);
            // set rejectUnauthorized because most IRC servers don't have certified certificates anyway.
        } else {
            this.genericSocket = this.genericSocket.connect(this.port, this.netname, this.setupEvents);
        }
    },

    end : function () {
        if (!this.isConnected()) {
            return;
        }

        this.genericSocket.end();
    },

    raw : function (message) {
        if (!this.connected) {
            return;
        }

        if (util.isArray(message)) {
            message = message.join(" ");
        }

        if (message.indexOf('\n') !== -1) {
            throw new Error('Newline detected in message. Use multiple raws instead.');
        }

        log(false, message);
        this.genericSocket.write(message + '\n', 'ascii');
    },

    isConnected : function () {
        return this.connected;
    },

    getRealName : function () {
        return this._realname;
    }
});
