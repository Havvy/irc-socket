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
var inspect = require('util').inspect;

var create = function (prototype, properties) {
    if (typeof properties == 'object') {
        var props = {};
        Object.keys(properties).forEach(function (key) {
            props[key] = { value: properties[key] };
        });
    }

    return Object.create(prototype, props);
};

var Socket = module.exports = function Socket (config, NetSocket) {
    NetSocket = NetSocket || net.Socket;

    var socket = create(Socket.prototype);
    socket.port = config.port || 6667;
    socket.server = config.server;
    socket.ipv6 = config.ipv6 || false;
    socket.localAddress = config.localAddress || undefined;
    socket.secure = config.secure || false;
    socket.rejectUnauthorized = config.rejectUnauthorized || false;
    socket.network = config; // FIXME: Only put specific values on the network object.
    socket.impl = new NetSocket();
    socket.connected = false;

    socket._setupEvents = function () {
        var onData = function onData (data) {
            var lines = data.split('\r\n');

            if (onData.buffer) {
                lines[0] = onData.buffer + lines[0];
                onData.buffer = null;
            }

            if (lines[lines.length - 1] !== '') {
                onData.buffer = lines.pop();
            }

            lines
            .filter(function (line) { return line !== ''; })
            .forEach(function (line) {
                socket.emit('data', line);
            });
        };

        onData.buffer = null;

        var onLine = function onLine(line) {
            if (line.slice(0, 4) === 'PING') {
                socket.raw(['PONG', line.slice(line.indexOf(':'))]);

                if (onLine.timeoutInterval === 0) {
                    onLine.timeoutInterval = -(Date.now());
                } else if (onLine.timeoutInterval < 0) {
                    onLine.timeoutInterval = (Date.now() + onLine.timeoutInterval) * 3;
                    onLine.timeout = setTimeout(function () {
                        socket.emit("timeout");
                    }, onLine.timeoutInterval);
                }
            }

            // Any incoming message should reset the timeout.
            if (onLine.timeoutInterval > 0) {
                clearTimeout(onLine.timeout);
                onLine.timeout = setTimeout(function () {
                    socket.emit("timeout");
                }, onLine.timeoutInterval);
            }
        }

        onLine.timeoutInterval = 0;
        onLine.timeout = null;

        void function readyEvent () {
            var emitWhenReady = function (data) {
                if (Socket.isReady(data)) {
                    socket.emit('ready');
                }
            };

            socket.impl.on('data', emitWhenReady);
            socket.on('ready', function unsubscribeEmitWhenReady () {
                socket.impl.removeListener('data', emitWhenReady);
            });
        }();

        void function connectEvent () {
            var emitEvent = (socket.secure) ? 'secureConnect' : 'connect';
            var emitWhenConnected = function () {
                socket.localPort = socket.impl.localPort;
                socket.connected = true;
                socket.emit('connect');

                if (socket.network.capab) {
                    socket.raw(['CAP', 'LS']);
                }

                if (typeof socket.network.password === 'string') {
                    socket.raw(['PASS', socket.network.password]);
                }

                socket.raw(['NICK', socket.network.nickname || socket.network.nick]);
                socket.raw(['USER', socket.network.username || socket.network.user || 'user', '8', '*', socket.network.realname]);
            };

            socket.impl.on(emitEvent, emitWhenConnected);
        }();

        socket.impl.on('error', function (error) {
            socket.connected = false;
            socket.emit('error', error);
        });

        socket.impl.on('close', function () {
            socket.connected = false;
            socket.emit('close');
        });

        socket.impl.on('end', function () {
            socket.emit('end');
        });

        socket.impl.on('timeout', function () {
            socket.emit('timeout');
        });

        socket.impl.on('data', onData);
        socket.impl.setEncoding('utf-8');
        socket.impl.setNoDelay();

        socket.on('data', onLine);
        socket.on('timeout', function () {
            socket.end();
        });
    };

    socket._setupEvents();

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
            // FIXME: Cannot choose ipv6, localAddress with TLS
            // FIXME: Secure does not use NetSocket.
            this.impl = tls.connect(this.port, this.server, {rejectUnauthorized: this.rejectUnauthorized});
            this._setupEvents();
            // set rejectUnauthorized because most IRC servers don't have certified certificates anyway.
        } else {
            this.impl.connect(this.port, this.server, this.ipv6 ? 6 : 4, this.localAddress);
        }
    },

    end : function () {
        if (!this.isConnected()) {
            return;
        }

        this.impl.end();
    },

    raw : function (message) {
        if (!this.connected) {
            return;
        }

        if (Array.isArray(message)) {
            message = message.map(function (m) {
                return (m.indexOf(' ') !== -1) ? ':' + m : m;
            }).join(' ');
        }

        if (message.indexOf('\n') !== -1) {
            throw new Error('Newline detected in message. Use multiple raws instead.');
        }

        this.impl.write(message + '\r\n', 'utf-8');
    },
    
    setTimeout: function (timeout, callback) {
        this.impl.setTimeout(timeout, callback);
    },

    isConnected : function () {
        return this.connected;
    },

    getRealName : function () {
        return this._realname;
    }
});
