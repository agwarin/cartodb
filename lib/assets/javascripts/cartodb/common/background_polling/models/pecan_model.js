var Backbone = require('backbone');
var _ = require('underscore');

/**
 *  Pecan model
 *
 */

module.exports = cdb.core.Model.extend({

  _REJECT: 0,
  _KEEP: 1,
  _PRINT_STATS: true,

  defaults: {
    table_id: '',
    column: '',
    state: 'idle'
  },

  initialize: function() {
    _.bindAll(this, "_onDescribe");

    this.sql = cdb.admin.SQL();
    this.query = 'SELECT * FROM ' + this.get("table_id");
  },

  getData: function() {
    this.sql.describe(this.query, this.get("column"), {}, this._onDescribe);
  },

  _onDescribe: function(stats) {
    var properties = {
      state: "analyzed",
      success: false
    };

    if (stats.type === 'geom' && stats.bbox) {
      properties.bbox = stats.bbox;
    } else  if (this._analyzeStats(stats) === this._KEEP) {
      var response = cdb.CartoCSS.guessMap(this.query, this.get("table_id"), this, stats);

      if (response) {
        properties = _.extend(properties, { success: true }, stats, response);
      }
    }

    this.set(properties);
  },

  isAnalyzed: function() {
    return this.get('state') === 'analyzed';
  },

  hasFailed: function() {
    return this.get('state') === 'failed';
  },

  _analyzeStats: function(stats) {
    var name = this.get("column");
    var type = stats.type;

    if (this._PRINT_STATS) {
      this._printStats(stats);
    }

    var result = this._REJECT;

    if (type === 'string') {
      result = this._analyzeString(stats);
    } else if (type === 'number') {
      result = this._analyzeNumber(stats);
    } else if (type === 'boolean') {
      result = this._analyzeBoolean(stats);
    } else if (type === 'date') {
      result = this._analyzeDate(stats);
    }

    if (result === this._KEEP) {
      this._approveMessage(name);
    }

    return result;
  },

  _analyzeString: function(stats) {
    var name = this.get("column");

    if (stats.weight >= 0.8) {
      return this._KEEP;
    } else if (stats.weight < 0.1 || !stats.weight) {
      this._rejectMessage(name, "weight is 0", stats.weight);
      return this._REJECT;
    }

    if (stats.null_ratio > 0.95) {
      this._rejectMessage(name, "null_ratio > 95%", stats.null_ratio  * 100);
      return this._REJECT;
    }

    return this._REJECT;
  },

  _analyzeNumber: function(stats) {
    var name = this.get("column");
    var distinctPercentage = (stats.distinct / stats.count) * 100;
    var dist_type   = stats.dist_type;
    var calc_weight = cdb.CartoCSS.getWeightFromShape(dist_type);

    if (stats.weight < 0.1 || !stats.weight) {
      this._rejectMessage(name, "weight is 0", stats.weight);
      return this._REJECT;
    }

    if (calc_weight === 0.9) {
      return this._KEEP;
    } else if (stats.weight > 0.5 || distinctPercentage < 25) {
      if (distinctPercentage < 1) {
        this._redoMessage(name);
        return this._KEEP;
      }
      return this._KEEP;
    }

    this._rejectMessage(name, "distinctPercentage is > 25 && weight < 0.5");
    return this._REJECT;
  },

  _analyzeBoolean: function(stats) {
    var name = this.get("column");
    if (stats.null_ratio > 0.75) {
      this._rejectMessage(name, "null_ratio > 75%", stats.null_ratio  * 100);
      return this._REJECT;
    }
    return this._KEEP;
  },

  _analyzeDate: function(stats) {
    var name = this.get("column");

    if (this.get("geometry_type") === 'polygon') {
      return this._REJECT;
    }

    if (stats.null_ratio > 0.75) {
      this._rejectMessage(name, "null_ratio > 75%", stats.null_ratio  * 100);
      return this._REJECT;
    }
    return this._KEEP;
  },

  _printStats: function(stats) {
    var name        = this.get("column");
    var type        = stats.type;
    var weight      = stats.weight;
    var skew        = stats.skew;
    var distinct    = stats.distinct;
    var count       = stats.count;
    var null_ratio  = stats.null_ratio;
    var dist_type   = stats.dist_type;
    var calc_weight = cdb.CartoCSS.getWeightFromShape(dist_type);

    var distinctPercentage = (distinct / count) * 100;

    console.log("%cAnalyzing %c" + name, "text-decoration:underline; font-weight:bold", "text-decoration:underline; font-weight:normal");

    console.log('%c · %ctype%c = ' + type, 'color:#666;', 'color: #666; font-weight:bold;', "color: #666; font-weight:normal");
    console.log('%c · %cdistinctPercentage%c = ' + distinctPercentage, 'color:#666;', 'color: #666; font-weight:bold;', "color: #666; font-weight:normal");
    console.log('%c · %ccount%c = ' + count, 'color:#666;', 'color: #666; font-weight:bold;', 'color: #666; font-weight:normal;');
    console.log('%c · %cnull ratio%c = ' + null_ratio, 'color:#666;', 'color: #666; font-weight:bold;', 'color: #666; font-weight:normal;');

    if (dist_type) {
      console.log('%c · %cdist_type%c = ' + dist_type, 'color:#666;', 'color: #666; font-weight:bold;', 'color: #666; font-weight:normal;');
      console.log('%c · %ccalc_weight%c = ' + calc_weight, 'color:#666;', 'color: #666; font-weight:bold;', 'color: #666; font-weight:normal;');
    }

    if (skew) {
      console.log("%c · %cskew%c: " + skew.toFixed(2), "color:#666;", 'color: #666; font-weight:bold;', 'color: #666; font-weight:normal;');
    }

    if (weight) {
      console.log("%c · %cweight%c: " + weight.toFixed(2), "color: #666;", "color:#666; font-weight:bold;", "color:#666;font-weight:normal");
    }

  },

  _redoMessage: function(name, message, value) {
    if (this._PRINT_STATS) console.log('%c > turned into category', "color:pink;");
  },

  _rejectMessage: function(name, message, value) {
    if (this._PRINT_STATS) console.log('%c = rejected because ' + message + ": %c" + (value ? value : ""), "color:red;", "color:red; font-weight:bold");
  },

  _approveMessage: function(name) {
    if (this._PRINT_STATS) console.log('%c = approved', "color:green;");
  },

});