const expect = require('chai').expect;
const loglevel = require('loglevel');
const sinon = require('sinon');
const prefix = require('loglevel-plugin-prefix');

global.window = {
  XMLHttpRequest: sinon.useFakeXMLHttpRequest()
};

const plugin = require('../lib/loglevel-plugin-remote');
const other = require('loglevel-plugin-mock');

loglevel.setLevel('info');

const spy = sinon.spy();

describe('API', () => {
  afterEach(() => {
    try {
      plugin.disable();
      // eslint-disable-next-line no-empty
    } catch (ignore) {}
    try {
      other.disable();
      // eslint-disable-next-line no-empty
    } catch (ignore) {}
    try {
      plugin.disable();
      // eslint-disable-next-line no-empty
    } catch (ignore) {}
    spy.reset();
  });

  it('Methods', () => {
    expect(plugin).to.have.property('apply').with.be.a('function');
    expect(plugin).to.have.property('noConflict').with.be.a('function');
    expect(plugin).to.have.property('plain').with.be.a('function');
    expect(plugin).to.have.property('json').with.be.a('function');
    expect(plugin).to.have.property('disable').with.be.a('function');
    expect(plugin).to.have.property('setToken').with.be.a('function');
  });

  it('Empty arguments', () => {
    expect(plugin.apply).to.throw(TypeError, 'Argument is not a root loglevel object');
  });

  it('Not root loglevel argument', () => {
    expect(() => plugin.apply(loglevel.getLogger('log'))).to.throw(
      TypeError,
      'Argument is not a root loglevel object'
    );
  });

  it('Right applying', () => {
    expect(() => plugin.apply(loglevel)).to.not.throw();
  });

  it('Reapplying should throw an exception', () => {
    plugin.apply(loglevel);

    expect(() => plugin.apply(loglevel)).to.throw(Error, 'You can assign a plugin only one time');
  });

  it('Right disabling', () => {
    plugin.apply(loglevel);

    expect(plugin.disable).to.not.throw();
  });

  it('Disabling a not appled plugin should throw an exception', () => {
    expect(plugin.disable).to.throw(Error, "You can't disable a not appled plugin");
  });

  it('setToken for a not appled plugin should throw an exception', () => {
    expect(plugin.setToken).to.throw(Error, "You can't set token for a not appled plugin");
  });

  it('Disabling after using another plugin should throw an exception', () => {
    plugin.apply(loglevel);
    other.apply(loglevel);

    expect(plugin.disable).to.throw(
      Error,
      "You can't disable a plugin after appling another plugin"
    );
  });
});

describe('Common', () => {
  it('All methods of the previous plugin should be called', () => {
    other.apply(loglevel, { method: spy });
    plugin.apply(loglevel, { persist: 'never', interval: 0 });

    loglevel.enableAll();
    loglevel.trace('trace');
    loglevel.debug('debug');
    loglevel.info('info');
    loglevel.warn('warn');
    loglevel.error('error');
    expect(spy.callCount).to.equal(5);

    plugin.disable();
    other.disable();
  });
});

describe('Requests', () => {
  let server;
  const successful = [200, { 'Content-Type': 'text/plain', 'Content-Length': 2 }, 'OK'];
  const fail = [404, {}, ''];

  const quote = '"';
  const acute = '`';
  const apos = "'";
  const bs = '\\';
  const escape = `escape-${bs}n${bs}${quote}${bs}${acute}${bs}${apos}${bs}${bs}`;

  const time = new Date().toISOString();
  const timestamp = () => time;

  const simple = () => ({
    json: false,
    formatter: log => `${log.message}${log.stacktrace ? `\n${log.stacktrace}` : ''}`
  });

  function requests() {
    const result = [];
    server.requests.forEach((request) => {
      result.push(`${request.status}: ${request.requestBody.replace(/\n/g, '')}`);
    });
    return result;
  }

  function receivedPlain() {
    let result = [];
    server.requests.forEach((request) => {
      if (request.status === 200) {
        result = result.concat(request.requestBody.split('\n'));
      }
    });
    return result;
  }

  function receivedJSON() {
    let result = [];
    server.requests.forEach((request) => {
      if (request.status === 200) {
        result = result.concat(JSON.parse(request.requestBody).logs);
      }
    });
    return result;
  }

  beforeEach(() => {
    other.apply(loglevel);
    server = sinon.fakeServer.create();
  });

  afterEach(() => {
    plugin.disable();
    other.disable();
  });

  it('The plain log must be received', () => {
    plugin.apply(loglevel, { format: simple, persist: 'never', interval: 0 });

    loglevel.info(`plain-${escape}`);

    server.respondWith(successful);
    server.respond();

    const expected = [`plain-${escape}`];

    expect(expected).to.eql(receivedPlain());
  });

  it('The json log must be received', () => {
    plugin.apply(loglevel, {
      format: plugin.json,
      persist: 'never',
      interval: 0,
      timestamp
    });

    loglevel.info(`json-${escape}`);

    server.respondWith(successful);
    server.respond();

    const expected = [
      {
        message: `json-${escape}`,
        level: 'info',
        logger: '',
        timestamp: time,
        stacktrace: ''
      }
    ];

    expect(expected).to.eql(receivedJSON());
  });

  it('The log from child logger must be received', () => {
    plugin.apply(loglevel, { format: plugin.json, persist: 'never', interval: 0, timestamp });

    loglevel.getLogger('child').info('child logger');

    server.respondWith(successful);
    server.respond();

    const expected = [
      {
        message: 'child logger',
        level: 'info',
        logger: 'child',
        timestamp: time,
        stacktrace: ''
      }
    ];

    expect(expected).to.eql(receivedJSON());
  });

  it('Custom plain', () => {
    const getCounter = () => {
      let count = 1;
      // eslint-disable-next-line no-plusplus
      return () => count++;
    };
    const counter = getCounter();

    const custom = () => ({
      json: false,
      formatter: log => `[${counter()}] ${log.message}`
    });

    plugin.apply(loglevel, { format: custom, persist: 'never', interval: 0, timestamp });

    server.respondWith(successful);

    loglevel.info('Message one');
    server.respond();
    loglevel.info('Message two');
    server.respond();

    const expected = ['[1] Message one', '[2] Message two'];

    expect(expected).to.eql(receivedPlain());
  });

  it('Custom JSON', () => {
    const getCounter = () => {
      let count = 1;
      // eslint-disable-next-line no-plusplus
      return () => count++;
    };
    const counter = getCounter();

    const custom = () => ({
      json: true,
      formatter(log) {
        return {
          msg: log.message,
          lvl: log.level.value,
          log: log.logger,
          loc: 'home',
          count: counter()
        };
      }
    });

    plugin.apply(loglevel, { format: custom, persist: 'never', interval: 0, timestamp });

    server.respondWith(successful);

    loglevel.info('Message one');
    server.respond();
    loglevel.info('Message two');
    server.respond();

    const expected = [
      {
        msg: 'Message one',
        lvl: 2,
        log: '',
        loc: 'home',
        count: 1
      },
      {
        msg: 'Message two',
        lvl: 2,
        log: '',
        loc: 'home',
        count: 2
      }
    ];

    expect(expected).to.eql(receivedJSON());
  });

  it('Stacktrace', () => {
    plugin.apply(loglevel, {
      format: simple,
      persist: 'never',
      interval: 0,
      stacktrace: { depth: 4, excess: 1 }
    });
    prefix.apply(loglevel);

    function fn3() {
      loglevel.trace('Stacktrace');
    }

    function fn2() {
      fn3();
    }

    function fn1() {
      fn2();
    }

    fn1();

    server.respondWith(successful);
    server.respond();

    expect(receivedPlain()[0]).to.include('Stacktrace');
    expect(receivedPlain()[1]).to.include('fn3');
    expect(receivedPlain()[2]).to.include('fn2');
    expect(receivedPlain()[3]).to.include('fn1');
    expect(receivedPlain()[4]).to.include('Context.it');
    expect(receivedPlain()[5]).to.include('more');

    prefix.disable();
  });

  it('Undefined token', () => {
    plugin.apply(loglevel, { format: simple, persist: 'never', interval: 0, token: undefined });

    server.respondWith(successful);

    loglevel.info('A');
    server.respond();
    loglevel.info('B');
    server.respond();

    const expectedBefore = [];

    expect(expectedBefore).to.eql(receivedPlain());

    plugin.setToken('token');

    server.respond();

    const expectedAfter = ['A', 'B'];

    expect(expectedAfter).to.eql(receivedPlain());
  });

  /*
  it('The old and new plain logs must be received', () => {
    plugin.apply(loglevel, { format: simple, persist: 'always', interval: 0 });

    server.respondWith(fail);

    const old1 = `old-1-${escape}`;

    loglevel.info(old1);
    server.respond();
    loglevel.info('old-2');
    server.respond();

    plugin.disable();
    server = sinon.fakeServer.create();

    plugin.apply(loglevel, { format: simple, persist: 'always', interval: 0 });

    server.respondWith(successful);

    server.respond();

    loglevel.info('new-1');
    server.respond();
    loglevel.info('new-2');
    server.respond();

    const expected = [old1, 'old-2', 'new-1', 'new-2'];

    expect(expected).to.eql(receivedPlain());
  });
  */

  /*
  it('The old and new json logs must be received', () => {
    plugin.apply(loglevel, { format: plugin.json, persist: 'always', interval: 0, timestamp });

    server.respondWith(fail);

    const old1 = `old-1-${escape}`;

    loglevel.info(old1);
    server.respond();
    loglevel.info('old-2');
    server.respond();

    plugin.disable();
    server = sinon.fakeServer.create();

    plugin.apply(loglevel, { format: plugin.json, persist: 'always', interval: 0, timestamp });

    server.respondWith(successful);

    server.respond();

    loglevel.info('new-1');
    server.respond();
    loglevel.info('new-2');
    server.respond();

    const expected = [
      {
        message: old1,
        level: 'info',
        logger: '',
        timestamp: time,
        stacktrace: ''
      },
      {
        message: 'old-2',
        level: 'info',
        logger: '',
        timestamp: time,
        stacktrace: ''
      },
      {
        message: 'new-1',
        level: 'info',
        logger: '',
        timestamp: time,
        stacktrace: ''
      },
      {
        message: 'new-2',
        level: 'info',
        logger: '',
        timestamp: time,
        stacktrace: ''
      }
    ];

    expect(expected).to.eql(receivedJSON());
  });
  */

  it('Test persist:never -> down server', () => {
    plugin.apply(loglevel, { format: simple, persist: 'never', capacity: 3, interval: 0 });

    server.respondWith(fail);
    loglevel.info('A');
    server.respond();
    loglevel.info('B');
    server.respond();
    loglevel.info('C');
    server.respond();
    loglevel.info('D');
    server.respond();

    server.respondWith(successful);
    loglevel.info('E');
    server.respond();
    server.respond();

    /*
                         | sent | queue |                   | sent | queue |
    ------------------------------------------------------------------------
    info(A)              |      |     A |-> send(A)         |    A |       |
    respond(A)-> fail    |    A |       |-> send(A)         |    A |       |
    info(B)              |    A |     B |  !send (sending)  |--------------|
    respond(A)-> fail    |    A |     B |-> send(A)         |    A |     B |
    info(C)              |    A |    BC |  !send (sending)  |--------------|
    respond(A)-> fail    |      |    BC |-> send(BC)        |   BC |       |
    info(D)              |   BC |     D |  !send (sending)  |--------------|
    respond(BC)-> fail   |      |    CD |-> send(CD)        |   CD |       |
    info(E)              |   CD |     E |  !send (sending)  |--------------|
    respond(CD)-> succ   |      |     E |-> send(E)         |    E |       |
    respond(E)-> succ    |      |       |  !send (empty)    |--------------|
    */

    // const expected = ['404: A', '404: A', '404: A', '404: BC', '200: CD', '200: E'];
    const expected = ['C', 'D', 'E'];

    expect(expected).to.eql(receivedPlain());
  });

  it('Test persist:never -> owerflow', () => {
    plugin.apply(loglevel, { format: simple, persist: 'never', capacity: 3, interval: 0 });

    server.respondWith(successful);
    loglevel.info('A');
    loglevel.info('B');
    loglevel.info('C');
    loglevel.info('D');
    loglevel.info('E');
    loglevel.info('F');
    server.respond();
    server.respond();

    /*
                         | sent | queue |                   | sent | queue |
    ------------------------------------------------------------------------
    info(A)              |      |     A |-> send(A)         |    A |       |
    info(B)              |    A |     B |  !send (sending)  |--------------|
    info(C)              |    A |    BC |  !send (sending)  |--------------|
    info(D)              |    A |   BCD |  !send (sending)  |--------------|
    info(E)              |    A |   CDE |  !send (sending)  |--------------|
    info(F)              |    A |   DEF |  !send (sending)  |--------------|
    respond(A)->(succ)   |      |   DEF |-> send(DEF)       |  DEF |       |
    respond(DEF)->(succ) |      |       |  !send (empty)    |--------------|
    */
    const expected = ['200: A', '200: DEF'];

    expect(expected).to.eql(requests());
  });

  /*
  it('Test persist:always', () => {
    plugin.apply(loglevel, { persist: 'always', capacity: 3, interval: 0 });

    const emptyMessage = {
      message: '',
      level: 'info',
      logger: '',
      timestamp: new Date().toISOString(),
      stacktrace: ''
    };

    const emptyLength = JSON.stringify(emptyMessage).length;

    const padding = Array(Math.floor(1024 * 0.99) - emptyLength).join('A');

    const full = {
      message: `0${padding}`,
      level: 'info',
      logger: '',
      timestamp: new Date().toISOString(),
      stacktrace: ''
    };

    console.log(JSON.stringify(full).length);

    const sent = ['0', '1', '2', '3', '4'];

    server.respondWith(fail);
    sent.forEach((message, index) => {
      if (index === 4) {
        server.respondWith(successful);
      }
      loglevel.info(message + padding);
      server.respond();
    });
    server.respond();

    const expected = ['2', '3', '4'];

    let received = [];

    server.requests.forEach((request) => {
      // received.push(`${request.status}: ${request.requestBody.split('\n')}`);
      if (request.status === 200) {
        // received = received.concat(request.requestBody.split('\n'));
        received = received.concat(request.requestBody.split('\n').map(message => message[0]));
      }
    });

    console.log(received);
    expect(expected).to.eql(received);
  });
  */

  /*
  it('Test persist:always -> down server', () => {
    plugin.apply(loglevel, { persist: 'always', capacity: 3, interval: 0 });

    const padding = Array(Math.floor(512 * 0.99)).join('%');

    server.respondWith(fail);

    const A = `A${padding}`;
    const B = `B${padding}`;
    const C = `C${padding}`;
    const D = `D${padding}`;
    const E = `E${padding}`;

    console.log('A', A.length);

    loglevel.info(A);
    server.respond();
    loglevel.info(B);
    server.respond();
    loglevel.info(C);
    server.respond();
    loglevel.info(D);
    server.respond();

    server.respondWith(successful);
    loglevel.info(E);
    server.respond();
    server.respond();

    const expected = [C, D, E];

    expect(expected).to.eql(receivedPlain());
  });
*/
  /*
  it('Test persist:always -> owerflow', () => {
    plugin.apply(loglevel, { format: simple, persist: 'always', capacity: 3, interval: 0 });

    const padding = Array(Math.floor(512 * 0.9)).join('%');

    const A = `A${padding}`;
    const B = `B${padding}`;
    const C = `C${padding}`;
    const D = `D${padding}`;
    const E = `E${padding}`;
    const F = `F${padding}`;

    server.respondWith(successful);

    loglevel.info(A);
    loglevel.info(B);
    loglevel.info(C);
    loglevel.info(D);
    loglevel.info(E);
    loglevel.info(F);
    server.respond();
    server.respond();

    const expected = [A, D, E, F];

    expect(expected).to.eql(receivedPlain());
  });
  */
});
