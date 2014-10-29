var cluster = require('cluster');
var crypto = require('crypto');
var cedar = require('../../cedar');
var stringify = require('../common/stringify');
var Base = require('./base');

/**
 * The `Multi` logger logs to an array of loggers.
 */
var Multi = module.exports = function (loggers) {

  // Give the logger an ID based on its configuration, and register it.
  var json = stringify(loggers);
  var hash = crypto.createHash('md5').update(json).digest('hex');
  var id = 'CEDAR_' + hash.substr(0, 8);

  var logger;

  // In the master process, log to each transport.
  if (cluster.isMaster) {

    // The multi logger is a "log" function alias, like all other Cedar loggers.
    logger = function () {
      for (var i = 0, l = loggers.length; i < l; i++) {
        var item = logger[i];
        item.apply(item, arguments);
      }
    };

    // Set the array of loggers as a property.
    logger.loggers = loggers;

    // Instantiate a Cedar logger for each item in the array.
    loggers.forEach(function (item, i) {
      if (typeof item == 'string') {
        item = {transport: item};
      }
      else if (!item.transport) {
        item.transport = 'console';
      }
      logger[i] = loggers[i] = cedar(item.transport, item);
    });

    // Set up all logging methods.
    Base.levels.forEach(function (methodName) {
      logger[methodName] = function () {
        for (var i = 0, l = loggers.length; i < l; i++) {
          var item = logger[i];
          item[methodName].apply(item, arguments);
        }
      };
    });

    // Register the logger in the `Multi` map so workers can reach it.
    Multi[id] = logger;
  }

  // In worker processes, send log messages to the master.
  else {

    // Send a log message.
    logger = function () {
      var args = Array.prototype.slice.call(arguments);
      process.send(logger.id + 'log' + stringify(args));
    };

    // Set up all logging methods.
    Base.levels.forEach(function (methodName) {
      var glue = '.' + methodName;
      logger[methodName] = function () {
        var args = Array.prototype.slice.call(arguments);
        // TODO: Analyze whether we suffer from blocking while message passing.
        process.send(logger.id + methodName + stringify(args));
      };
    });

  }


  // Self identify as a Multi logger.
  logger.transport = 'multi';
  logger.id = id;

  return logger;

};

// Listen for messages from workers.
if (cluster.isMaster) {
  cluster.on('listening', function (worker) {
    worker.on('message', function (message) {
      var id = message.substr(0, 14);
      var pos = message.indexOf('[');
      var type = message.substring(14, pos);
      var data = message.substring(pos);
      try {
        data = JSON.parse(data);
      }
      catch (e) {
      }
      var logger = Multi[id];
      if (logger) {
        var loggers = logger.loggers;
        for (var i = 0, l = loggers.length; i < l; i++) {
          var item = logger[i];
          if (!item.worker || (item.worker == worker.id)) {
            item[type].apply(item, data);
          }
        }
      }
    });
  });
}