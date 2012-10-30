var events = require('events');
var util = require('util');
var underscore = require('underscore');
var dateformat = require("dateformat");

exports.init = function(db, cb) {
  exports.db = db;
  exports.db.run(
    "create table events (id integer primary key autoincrement, timestamp timestamp, class varchar(32), data text, device varchar(256), lat real, lon real)",
    function () {
      exports.db.run(
        "create table devices (name varchar(256), last_seen integer references events(id))", cb);
    }
  );
}

exports.getDevices = function (cb) {
  var devices = [];
  exports.db.each(
    "select devices.name as name, events.data as data from devices join events on devices.last_seen = events.id",
    function(err, row) {
      var data = JSON.parse(row.data);
      if (data.class == 'DEVICES') {
        data = data.devices.filter(function (device) { return device.path == row.name; })[0];
      }
      devices.push(data);
    },
    function(err, rows) {
      cb(err, devices);
    }
  );
}

exports.Logger = function() {
  var self = this;

  self.on('receiveCommand_WATCH', function (params) {
    exports.db.get(
      "select data from events where class not in ('VERSION', 'DEVICES', 'DEVICE', 'WATCH', 'REPLAY') order by timestamp desc limit 1",
      function(err, row) {
        self.sendResponse(JSON.parse(row.data));
    });
  });

  self.on('receiveCommand_REPLAY', function (params) {
    if (params.from) {
      exports.db.each(
        "select data from events where class not in ('VERSION', 'DEVICES', 'DEVICE', 'WATCH', 'REPLAY') and timestamp > ? order by timestamp asc",
        params.from,
        function(err, row) {
          self.sendResponse(JSON.parse(row.data));
      });
    } else {
      exports.db.each(
        "select data from events where class not in ('VERSION', 'DEVICES', 'DEVICE', 'WATCH', 'REPLAY') order by timestamp asc",
        function(err, row) {
          self.sendResponse(JSON.parse(row.data));
      });
    }
  });

  self.on('receiveResponse_VERSION_REPLAY', function (data) {
    exports.db.get(
      "select timestamp from events where class not in ('VERSION', 'DEVICES', 'DEVICE', 'WATCH', 'REPLAY') order by timestamp desc limit 1",
      function(err, row) {
        if (err || !row) {
          self.sendCommand("REPLAY", {});
        } else {
          self.sendCommand("REPLAY", {from:row.timestamp});
        }
      }
    );
  });

  self.on('receiveResponse', function (response) {
    exports.db.run(
      "insert into events (timestamp, class, data, device, lat, lon) values ($timestamp, $class, $data, $device, $lat, $lon)",
      {$timestamp:response.time,
       $class:response.class,
       $data:JSON.stringify(response),
       $device:response.device,
       $lat:response.lat,
       $lon:response.lon},
      function (err) {
        if (err) { console.log(err); return; }
        response.id = this.lastID;
        self.emit("saveResponse", response);
      }
    );
  });

  self.on('saveResponse', function (response) {
    if (response.class) {
      self.emit('saveResponse_' + response.class, response);
    }
  });

  self.on('saveDevice', function (data) {
    exports.db.get(
      "select count(*) as count from devices where name = $name",
      {$name: data.path},
      function(err, row) {
        if (row.count > 0) {
          exports.db.run(
            "update devices set last_seen = $id where name = $path",
            {$path:data.path,
             $id:data.id});
        } else {
          exports.db.run(
            "insert into devices (name, last_seen) values ($path, $id)",
            {$path:data.path,
             $id:data.id});
        }
    });
  });

  self.on('saveResponse_DEVICE', function (data) {
    self.emit('saveDevice', data);
  });

  self.on('saveResponse_DEVICES', function (data) {
    data.devices.map(function (device) {
      device.id = data.id;
      self.emit('saveDevice', device);
    });
  });


  self.on('receiveCommand_WATCH', function (params) {
    exports.getDevices(function (err, devices) {
      devices.map(function (device) {
        self.sendResponse(device);
      });
    });
  });

  self.on("serverInitialResponse", function () {
    exports.getDevices(function (err, devices) {
      self.sendResponse({class: 'DEVICES',
                         devices: devices});
    });
  });

};