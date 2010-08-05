process.mixin(require("./common"));

var rpc = require('../../JSON-RPC/jsonrpc'),
  http = require('http');
  
var PORT = 8998;

rpc.service = require('../../JSON-RPC/service');
var server = rpc.createServer();
server.listen(PORT);


var client = http.createClient(PORT);

var requests = [
  // one positioned parameter
  {
    method: "echo",
    params: "['abc']",
    id: "99",
    expected: '{"jsonrpc":"2.0","result":"abc","id":"99"}',
    code: 200
  },
  // one named parameter
  {
    method: "echo",
    params: "{a:'abc'}",
    id: "99",
    expected: '{"jsonrpc":"2.0","result":"abc","id":"99"}',
    code: 200
  },
  // two positioned parameter
  {
    method: "add",
    params: "[2,3]",
    id: "12",
    expected: '{"jsonrpc":"2.0","result":5,"id":"12"}',
    code: 200
  }
  // two named parameter
  // notification
  // asynchronous method call
  // parse error
  // invalid request
  // method not found
  // invalid parameters
  // alot of batch tests
];

// get requests
for (var i = 0; i < requests.length; i++) {
  var method = requests[i].method;
  var params = requests[i].params;
  var id = requests[i].id;
  
  var req = client.get("/?jsonrpc=2.0&method=" + method + "&params=" + params + "&id=" + id, {"Content-type": "application/json-rpc"});  
  req.finish(function(req) { return function (res) {
    var body = "";  
    assertEquals(req.code, res.statusCode);
    res.setBodyEncoding("utf8"); 
    res.addListener("body", function (chunk) { body += chunk; });
    res.addListener("complete", function(exp) { return function() {
      assertEquals(exp, body);
      close();
    };}(req.expected));
  };}(requests[i]));  
}

var closed = 0;
var close = function() {
  closed++;
  if (closed == requests.length) {
    server.close();
  }
}
