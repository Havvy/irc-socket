const EEProto = require('events').EventEmitter.prototype;
const sinon = require('sinon');

const create = function (prototype, properties) {
  if (typeof properties !== 'object') {
    return Object.create(prototype);
  }

  const props = {};
  Object.keys(properties).forEach(function (key) {
    props[key] = { value: properties[key] };
  });
  return Object.create(prototype, props);
};

const MockGenericSocket = module.exports = function MockGenericSocket () {
  return create(EEProto, {
    connect : sinon.spy(function () {
      this.emit("connect");
      setTimeout((function () {
        this.emit("data", MockGenericSocket.messages.ping);
        this.emit("data", MockGenericSocket.messages['001']);
        this.isConnected = true;
      }).bind(this), 0);
    }),

    end :  function () { this.emit('close'); },
    write : sinon.spy(),
    setNoDelay : sinon.spy(),
    setEncoding : sinon.spy()
  });
};

MockGenericSocket.messages = {
  "001" : ":irc.test.net 001 testbot :Welcome to the Test IRC Network testbot!testuser@localhost\r\n",
  ping : 'PING :PINGMESSAGE\r\n',
  multi1: "PING :ABC\r\nPRIVMSG somebody :This is a re",
  multi2: "ally long message!\r\n"
};
