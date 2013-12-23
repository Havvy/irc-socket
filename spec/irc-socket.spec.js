var MockGenericSocket = require('./mock-generic-socket.js');
var IrcSocket = require('../irc-socket.js');
var util = require('util');

var network = Object.freeze({
    nick : 'testbot',
    user : 'testuser',
    server : 'irc.test.net',
    realname: 'realbot',
    port: 6667
});

var box = function (value) {
    return function () {
        return value;
    };
};

describe("Helper Functions", function () {
    describe("isReady", function () {
        it("emits true for 001 messages", function () {
            expect(IrcSocket.isReady(MockGenericSocket.messages['001'])).toBeTruthy();
        });

        it("emits false for everything else", function () {
            expect(IrcSocket.isReady(MockGenericSocket.messages.ping)).toBeFalsy();
        });
    });
});

describe("IRC Sockets", function () {
    describe("Know when connected", function () {
        var socket;

        it('not connected at instantiation.', function () {
            socket = IrcSocket(network, MockGenericSocket);
            expect(socket.isConnected()).toBeFalsy();
        });

        it('connected once connected.', function () {
            socket.connect();
            expect(socket.isConnected()).toBeTruthy();
        });

        it('not connected once ended', function () {
            socket.end();
            expect(socket.isConnected()).toBeFalsy();
        });
    });

    describe("Startup procedures", function () {
        it('Sending NICK and USER to the server on connection', function () {
            var genericsocket = MockGenericSocket();
            var socket = IrcSocket(network, box(genericsocket));
            socket.connect();
            socket.end();
            expect(genericsocket.write).toHaveBeenCalledWith('NICK testbot\r\n', 'utf-8');
            expect(genericsocket.write).toHaveBeenCalledWith('USER testuser 8 * realbot\r\n', 'utf-8');
        });

        it('Sends Ready Events on 001', function () {
            var readyIsCalled = false, socket;

            runs(function () {

                socket = IrcSocket(network, MockGenericSocket);

                socket.on('ready', function checkForReady () {
                    readyIsCalled = true;
                });

                socket.connect();
            });

            waitsFor(function () {
                return readyIsCalled;
            }, "ready is emitted", 300);

            runs(function () {
                socket.end();
                expect(readyIsCalled).toBeTruthy();
            });
        });
    });

    describe('Other', function () {
        var genericsocket, socket;

        beforeEach(function () {
            genericsocket = MockGenericSocket();
            socket = IrcSocket(network, box(genericsocket));
        });

        afterEach(function () {
            socket.end();
        });

        it('responds to pings', function () {
            runs(function () {
                socket.connect();
            });

            waitsFor(function () {
                return genericsocket.isConnected;
            }, "socket to connect", 400);

            runs(function () {
                expect(genericsocket.write).toHaveBeenCalledWith('PONG :PINGMESSAGE\r\n', 'utf-8');
            });
        });

        describe('Emitted data', function () {
            var spy;

            beforeEach(function () {
                spy = jasmine.createSpy("onData");
                runs(function () {
                    socket.on('data', spy);
                    socket.connect();
                });

                waitsFor(function () {
                    return genericsocket.isConnected;
                }, "socket to connect", 400);
            });

            it("emits each IRC line in a data event", function () {
                runs(function () {
                    expect(spy).toHaveBeenCalledWith(':irc.test.net 001 testbot :Welcome to the Test IRC Network testbot!testuser@localhost');
                });
            });

            //  :/
            xit("handles lines that don't fit in a single impl socket package", function () {
                var emitted = false;

                runs(function () {
                    genericsocket.emit(MockGenericSocket.messages.multi1);
                    genericsocket.emit(MockGenericSocket.messages.multi2);
                    emitted = true;
                });

                waitsFor(function () {
                    return emitted;
                }, "messages to emit", 50);
                
                runs(function () {
                    expect(spy).toHaveBeenCalledWith("PING :ABC");
                    expect(spy).toHaveBeenCalledWith("PRIVMSG somebody :This is a really long message!");
                });
            });
        });
    });
});
