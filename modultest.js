var rpc = require('./jsonrpc');
rpc.service = require("./service");
rpc.createServer().listen(8000);