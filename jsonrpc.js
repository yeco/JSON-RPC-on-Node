/**
 * JOSN-RPC 1.0 and 2.0 implementation running on node.js
 * 
 * http://json-rpc.org/wiki/specification
 * http://groups.google.com/group/json-rpc/web/json-rpc-1-2-proposal
 * http://groups.google.com/group/json-rpc/web/json-rpc-over-http
 * 
 * http://nodejs.org/
 * 
 */

// require the system stuff 
var sys = require('sys'), 
   http = require('http');

// default settings
exports.version = "2.0";
exports.service = null;

exports.createServer = function() {
  
  if (exports.service == null) {
    sys.puts("Please supply a service file via .service.");
    process.exit(10);
  }
  
  return http.createServer(function (req, res) {
    // handle GET requests
    if (req.method === "GET" && req.uri.params.method) {
      try {
        var rpcRequest = {
          method: req.uri.params.method,
          params: JSON.parse(req.uri.params.params),
          id: req.uri.params.id
        };
        processRequest(rpcRequest, res);
      } catch (e) {
        var error = parseError();
        send(res, error.response, error.httpCode);
      }

    // handle POST requests
    } else {
      req.setBodyEncoding("utf8");
      var body = "";
      req.addListener("body", function(chunk) {
        body += chunk;
      });

      req.addListener("complete", function() {
        try {
          var rpcRequest = JSON.parse(body);        
          processRequest(rpcRequest, res);
        } catch (e) {
          var error = parseError();
          send(res, error.response, error.httpCode);        
        }
      });
    } 
  });  
}


var processRequest = function(rpcRequest, res) {
  // batch case for version 2.0
  if (exports.version == "2.0" && rpcRequest instanceof Array) {
    var response = [];
    var httpCode = 200;
    for (var i = 0; i < rpcRequest.length; i++) {
      // check for invalid requests
      if (!(rpcRequest[i] instanceof Object)) {
        var error = invalidRequest();
        send(res, error.response, error.httpCode);
        return;
      }
      
      response[i] = null;
      var result = processSingleRequest(rpcRequest[i]);
      
      // async handling
      if (result instanceof process.Promise) {
        
        // not failed        
        var okHandler = function(i) {
          return function(result) {
            response[i] = createResponse(result, null, rpcRequest[i]);
            conditionalSend(res, rpcRequest, response, httpCode);          
          };
        }(i);
        result.addCallback(okHandler);

        // failed
        var errorHandler = function(i) {
          return function(e) {    
            var error = internalError(rpcRequest[i]);
            response[i] = error.response;
            conditionalSend(res, rpcRequest, response, httpCode);          
          };
        }(i);
        result.addErrback(errorHandler);  
      // sync handling      
      } else {
        response[i] = result.httpCode == 204 ? "NOTIFICATION" : result.response;
      }
    }
    conditionalSend(res, rpcRequest, response, httpCode);
    
  // non batch case
  } else {
    var response = processSingleRequest(rpcRequest);
    if (response instanceof process.Promise) {
      // not failed
      response.addCallback(function(result) {
        send(
          res, 
          createResponse(result, null, rpcRequest), 
          rpcRequest.id != null ? 200 : 204
        );                    
      });
      // failed
      response.addErrback(function(e) {    
        var error = internalError(rpcRequest);
        send(res, error.response, error.httpCode);            
      });
    } else {
      send(res, response.response, response.httpCode);
    }    
  } 
}

var processSingleRequest = function(rpcRequest) {
  // validate
  var error = checkValidRequest(rpcRequest)
  if (error) { return error };
  
  // named parameter handling
  if (
    exports.version == "2.0" && 
    rpcRequest.params instanceof Object &&
    !(rpcRequest.params instanceof Array)
  ) {
    rpcRequest.params = paramsObjToArr(rpcRequest);
  }
  
  try {
    // check for param count
    if (exports.service[rpcRequest.method].length != rpcRequest.params.length) {
      return invalidParams(rpcRequest);
    }
    
    var result = exports.service[rpcRequest.method].apply(exports.service, rpcRequest.params);
    
    // check for async requests
    if (result instanceof process.Promise) {
      return result;
    // sync requests
    } else {
      return {
        httpCode: rpcRequest.id != null ? 200 : 204, 
        response: createResponse(result, null, rpcRequest)
      };      
    }
  } catch (e) {
    return methodNotFound(rpcRequest);
  }
}

var send = function(res, rpcRespone, httpCode) {
  // default resposes
  if (httpCode != 204) {
    res.sendHeader(httpCode, {'Content-Type': 'application/json-rpc'});
    res.sendBody(JSON.stringify(rpcRespone));    
  // notification response
  } else {
    res.sendHeader(204, {'Connection': 'close'});    
  }
  res.finish();
}

var conditionalSend = function(res, rpcRequest, response, httpCode) {
  var done = true;
  for (var i = rpcRequest.length - 1; i >= 0; i--) {
    if (response[i] == null) {
      done = false;
      break;
    }
    if (response[i] == "NOTIFICATION") {
      response.splice(i, 1);
    }
  }
  if (done) {
    send(res, response, httpCode);      
  }  
}

var createResponse = function(result, error, rpcRequest) {
  if (exports.version === "2.0") {
    var rpcResponse = {
      jsonrpc: "2.0"
    };
    error != null ? rpcResponse.error = error : rpcResponse.result = result
    rpcResponse.id = rpcRequest && rpcRequest.id ? rpcRequest.id : null;
    return rpcResponse;
  } else {
    return {
      result : result || null,
      error : error || null,
      id : rpcRequest && rpcRequest.id ? rpcRequest.id : null 
    };    
  }
}

var checkValidRequest = function(rpcRequest) {
  if (
    !rpcRequest.method || 
    !rpcRequest.params || 
    rpcRequest.id === undefined
  ) {    
    return invalidRequest(rpcRequest);
  }
  var params = rpcRequest.params;
  if (exports.version == "2.0") {
    if (params instanceof Array || params instanceof Object) {
      return;
    }
  } else {
    if (params instanceof Array) {
      return;
    }
  }
  return invalidRequest(rpcRequest);
}



/**
 * Named arguments handling
 */
var paramsObjToArr = function(rpcRequest) {
  var argumentsArray = [];
  var argumentNames = getArgumentNames(exports.service[rpcRequest.method]);
  for (var i=0; i < argumentNames.length; i++) {
    argumentsArray.push(rpcRequest.params[argumentNames[i]]);
  }
  return argumentsArray;
}

var getArgumentNames = function(fcn) {
  var code = fcn.toString();
  var args = code.slice(0, code.indexOf(")")).split(/\(|\s*,\s*/);
  args.shift();
  return args;
}



/**
 * ERROR HANDLING
 */
var createError = function(code, message) {
  return {code : code, message : message};
}

var parseError = function() {
  return {httpCode: 500, response: 
    createResponse(null, createError(-32700, "Parse error."), null)};
}

var invalidRequest = function(request) {
  return {httpCode: 400, response: 
    createResponse(null, createError(-32600, "Invalid Request."), request)};
}

var methodNotFound = function(request) {
  return {httpCode: 404, response: 
    createResponse(null, createError(-32601, "Method not found."), request)};  
}

var invalidParams = function(request) {
  return {httpCode: 500, response: 
    createResponse(null, createError(-32602, "Invalid params."), request)};
}

var internalError = function(request) {
  return {httpCode: 500, response: 
    createResponse(null, createError(-32603, "Internal error."), request)};  
}