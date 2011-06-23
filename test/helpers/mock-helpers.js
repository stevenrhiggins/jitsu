
require.paths.unshift(require('path').join(__dirname, '..', 'lib'));

var assert = require('assert'),
    eyes = require('eyes'),
    jitsu = require('jitsu'),
    http = require('http'),
    util = require('util'),
    optimist = require('optimist'),
    it = require('it-is'),
    nodemock = require('nodemock'),
    inspect = require('eyes').inspector({ stream: null })
    base64 = require('jitsu/utils/base64'),
    MockRequest = require('./mock-request').MockRequest;

var port = 90210,
    remoteHost = 'api.mockjitsu.com';
    
var username = optimist.argv.username = 'mickey',
    password = optimist.argv.password = 'poiuytrewq',
    auth = 'Basic ' + base64.encode(username + ':' + password);
    
exports.requestOptions = {
  host: remoteHost,
  port: port,
  headers: {
    'Authorization': auth,
    'Content-Type': 'application/json'
  }
}

function mockPrompt (expected, answer) {

  if (!answer) {
    answer = expected;
    expected  = Object.keys(expected);
  }

  var prompt = nodemock.mock('get').takes(expected,function (){}).calls(1,[null, answer]);
  
  prompt.pause = function (){return this};
  prompt.start = function (){return this};//TODO: check pause was called.

  prompt.addProperties = function (obj,properties,callback) {
    prompt.get(properties, function (err,answer) {
      for( var key in answer) {
        obj[key] = answer[key];
      }
      callback(null,obj);
    });
  }
  return prompt;
}

exports.mockPrompt = mockPrompt;

function makeProperties (answer) {
  var expected = [];
  
  for (var name in answer) {
    expected.push({name: name, default: answer[name]});
  }

  return expected;
}

function mockPrompt2 (/*variable arguments*/) {

  var prompt;

  [].slice.call(arguments).forEach(function (answer){
    var m;
    m = !prompt ? prompt = nodemock.mock('get') : prompt.mock('get');

    m.takes(makeProperties(answer),function(){}).calls(1,[null,answer]);
  
  });
  
  prompt.addProperties = function (obj, properties, callback) {
    prompt.get(properties, function (err, answer) {
      for(var key in answer) {
        obj[key] = answer[key];
      }
      callback(null,obj);
    })
  }

  prompt.start = function (){return prompt};
  prompt.pause = function (){return prompt};

  return prompt;
}

exports.mockPrompt2 = mockPrompt2;

//TODO: i've since realised that nodemock actually supports this stuff.

function stubStream () {
  return {
    on: function () { console.log('*on') }, 
    emit: function () { console.log('*emit') }, 
    removeListener: function (){ console.log('*emit') }, 
    end: function () { console.log('*end') } 
  };
}

function mockRequest (requests) {
  function mockOneRequest (expected, result, status) {
    console.dir(arguments);
    //
    // Authorization is always set.
    //
    expected.headers.Authorization = auth;
    var mocked = nodemock.mock('request')
      .takes(expected, function () {})
      .returns(stubStream())
      .calls(1, [null, { statusCode: status }, JSON.stringify(result)]);
      
    return mocked.request;
  }

  var mocked = requests.map(function (e) { return mockOneRequest.apply(null, e) }), 
      calls = mocked.length, 
      count = 0;

  return function (expected, callback) {
    var next = mocked.shift();
    if (next) {
      count ++;
      return next.call(null,expected,callback);
    } 
    else {
      throw new Error('expected ' + calls + ' but got ' + (++count) + ' calls to request\n called with:' + inspect(expected) );
    }
  }  
}

exports.mockRequest = mockRequest;

function makeReq (method, path, json) {
  var req = { 
    method: method, //request
    uri: 'http://api.mockjitsu.com:90210' + path,
    headers: {} 
  };
  
  if (json) { req.body = JSON.stringify(json) }
  
  return req;
}

exports.makeReq = makeReq;

function res (req, res, status, headers) {
  var list = [];
  list.push([req, res || {}, status || 200]);
  list.res = function (req,res,status) {
    list.push([req, res || {}, status || 200]);
    return list;
  };
  return list;
}

exports.res = res;

exports.runJitsuCommand = function () {
  var args = Array.prototype.slice.call(arguments),
      assertion = "should respond with no error",
      assertFn,
      setupFn,
      mockRequest,
      userPrompt;
      
  args.forEach(function (a) {
    if (typeof a === 'function' && a.name === 'setup') {
      setupFn = a;
    }
    else if (typeof a === 'function') {
      assertFn = a;
    }
    else if (typeof a === 'string') {
      assertion = a;
    }
    else if (a instanceof MockRequest) {
      mockRequest = a;
    }
    else {
      userPrompt = a;
    }
  });
  
  if (!mockRequest) {
    console.log('Mock request is required for `runJitsuCommand`');
    process.exit(-1);
  }
  
  var context = {
    topic: function () {
      //
      // Remark: These are not documented.
      //
      optimist.argv.remoteHost = remoteHost;
      optimist.argv.port = port;
      
      var that = this,
          _setup = jitsu.setup, 
          _request = mockRequest.run(),
          argv;
          
      argv = {
        '_': this.context.name.split(' ')
      };  
      
      //
      // Mock the command-line prompt
      //
      jitsu.prompt = userPrompt || mockPrompt([]);

      function mockClients () {
        ['users', 'apps', 'snapshots'].forEach(function (client) {
          jitsu[client]._request = _request;
        });
      }

      if (!jitsu.started) {
        //
        // Mock the `_request` member in the API clients.
        //
        jitsu.setup = function (callback) {
          _setup(function () {
            mockClients();
            callback();
          });
        }
      }
      else {
        mockClients();
      }
       
      // Pad the output slightly
      console.log('');
      
      //
      // If there is a setup function then call it
      //
      if (setupFn) {
        setupFn();
      }
      
      //
      // Execute the target command and assert that no error
      // was returned.
      //
      jitsu.start(argv, function () {
        // Pad the output slightly
        console.log('');

        that.callback.apply(that, arguments);
      });
      
    }
  };

  context[assertion] = assertFn 
    ? assertFn 
    : function (err) { assert.isTrue(!err) };
  
  return context;
};