var EEProto = require('events').EventEmitter.prototype;

var create = function (prototype, properties) {
  if (typeof properties !== 'object') {
    return Object.create(prototype);
  }

  var props = {};
  Object.keys(properties).forEach(function (key) {
    props[key] = { value: properties[key] };
  });
  return Object.create(prototype, props);
};

var GenericMockSocket = module.exports = function GenericMockSocket () {
  return create(EEProto, {
    connect : jasmine.createSpy('connect').andCallFake(function () {
      this.emit("connect");
      setTimeout((function () {
        this.emit("data", GenericMockSocket.messages.ping);
        this.emit("data", GenericMockSocket.messages['001']);
        this.isConnected = true;
      }).bind(this), 0);
    }),

    end :  function () { this.emit('close'); },
    write : jasmine.createSpy("mocksocket.write"),
    setNoDelay : jasmine.createSpy(),
    setEncoding : jasmine.createSpy()
  });
};

GenericMockSocket.messages = {
  "001" : ":irc.test.net 001 testbot :Welcome to the Test IRC Network testbot!testuser@localhost\r\n",
  ping : 'PING :PINGMESSAGE\r\n',
  multi1: "PING :ABC\r\nPRIVMSG somebody :This is a re",
  multi2: "ally long message!\r\n" 
};
