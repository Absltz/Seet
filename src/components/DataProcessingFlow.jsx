import {useRef} from 'react';
import {useGSAP} from '@gsap/react';
import gsap from 'gsap';
import './data-processing-flow.css';

gsap.registerPlugin(useGSAP);

export default function DataProcessingFlow({working = false, className = '', label = 'AI'}) {
 const root = useRef(null);
 useGSAP(() => {
  if (!working) return;
  const media = gsap.matchMedia();
  media.add('(prefers-reduced-motion: no-preference)', () => {
   gsap.to('.data-processing-orbit', {rotation: 360, svgOrigin: '240 80', duration: 14, repeat: -1, ease: 'none'});
   gsap.fromTo('.data-processing-packet', {x: 0, opacity: 0}, {x: 98, opacity: 1, duration: 1.8, repeat: -1, stagger: .6, ease: 'power1.inOut', yoyo: true});
  });
  return () => media.revert();
 }, {scope: root, dependencies: [working], revertOnUpdate: true});
 return <div ref={root} className={`data-processing-flow${working ? ' is-working' : ''} ${className}`} aria-hidden="true"><svg viewBox="0 0 480 160" fill="none">
  <path d="M104 80H202M278 80H376" stroke="currentColor" strokeOpacity=".17" strokeDasharray="3 6"/>
  <g><rect x="33" y="40" width="62" height="81" rx="7" fill="var(--surface)" stroke="currentColor" strokeOpacity=".2" transform="rotate(-8 64 80)"/><rect x="42" y="35" width="62" height="81" rx="7" fill="var(--surface)" stroke="currentColor" strokeOpacity=".35"/><path d="M54 55H90M54 66H90M54 77H90M54 88H90M66 55V98M79 55V98" stroke="currentColor" strokeOpacity=".3"/></g>
  <circle cx="240" cy="80" r="39" fill="var(--raised)" stroke="currentColor" strokeOpacity=".16"/><circle cx="240" cy="80" r="28" fill="var(--surface)" stroke="currentColor" strokeOpacity=".1"/>
  <g className="data-processing-orbit"><ellipse cx="240" cy="80" rx="54" ry="23" stroke="#b9a971" strokeWidth="1.4" transform="rotate(-26 240 80)"/><circle cx="287" cy="57" r="4" fill="#b9a971"/></g>
  <text x="240" y="86" textAnchor="middle" fill="currentColor" fontSize="19" fontWeight="600">{label}</text>
  <g><rect x="376" y="35" width="73" height="81" rx="7" fill="var(--surface)" stroke="currentColor" strokeOpacity=".3"/><path d="M388 101H438" stroke="currentColor" strokeOpacity=".2"/><rect x="389" y="78" width="10" height="22" rx="2" fill="currentColor" fillOpacity=".35"/><rect x="407" y="62" width="10" height="38" rx="2" fill="currentColor" fillOpacity=".6"/><rect x="425" y="48" width="10" height="52" rx="2" fill="currentColor" fillOpacity=".9"/></g>
  <circle className="data-processing-packet" cx="112" cy="80" r="3" fill="currentColor"/><circle className="data-processing-packet" cx="279" cy="80" r="3" fill="#b9a971"/>
 </svg></div>;
}
