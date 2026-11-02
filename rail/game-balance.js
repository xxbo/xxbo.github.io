/* MAP17 progression parameters. Accounting units are retained for save compatibility.
   Development funding is a game reward, not passenger fares or a real transit subsidy. */
(function(root){'use strict';
const api=Object.freeze({VERSION:17,TRACK:80e6,STATION:40e6,CAR:3e6,OPERATING_FACTOR:.65,GRANT_RATE:11,HUB_CAPTURE_MAX:.65,HUB_MARKET_SCALE:120000});
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RailBalance=api;
})(typeof globalThis!=='undefined'?globalThis:this);
