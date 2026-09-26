import React from 'react';
// Next routing is outside these DOM interaction tests; preserve the actual href.
export default function Link({children, ...props}) {return React.createElement('a',props,children);}
