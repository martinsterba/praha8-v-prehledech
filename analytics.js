const GA_MEASUREMENT_ID='G-LT3T7S8DWC';

let lastTrackedLocation='';
function trackPageView(){
  window.setTimeout(()=>{
    const pageLocation=window.location.href;
    if(pageLocation===lastTrackedLocation)return;
    lastTrackedLocation=pageLocation;
    gtag('event','page_view',{
      page_title:document.title,
      page_location:pageLocation,
      page_path:window.location.pathname+window.location.search+window.location.hash
    });
  },0);
}

document.addEventListener('DOMContentLoaded',trackPageView,{once:true});
window.addEventListener('hashchange',trackPageView);
