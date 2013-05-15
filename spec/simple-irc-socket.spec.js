var MockGenericSocket = require('./mock-generic-socket.js');
var IrcSocket = require('../simple-irc-socket.js');
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
  xdescribe("Know when connected", function () {
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
      expect(genericsocket.write).toHaveBeenCalledWith('NICK testbot\n', 'ascii');
      expect(genericsocket.write).toHaveBeenCalledWith('USER testuser 8 * :' +
        'realbot\n', 'ascii');
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
        expect(genericsocket.write).toHaveBeenCalledWith('PONG :PINGMESSAGE\n', 'ascii');
      });
    });

    it("emits each IRC line in a 'data' event", function () {
      var spy = jasmine.createSpy("onData");
      runs(function () {
        socket.on('data', spy);
        socket.connect();
      });

      waitsFor(function () {
        return genericsocket.isConnected;
      }, "socket to connect", 400);

      runs(function () {
        expect(spy).toHaveBeenCalledWith(':irc.test.net 001 testbot :Welcome to the Test IRC Network testbot!testuser@localhost');
      });
    });
  });
});
