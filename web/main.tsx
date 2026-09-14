import React from 'react';
import {createRoot} from 'react-dom/client';
import Simas from '../app/simas';
import '../app/globals.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><Simas/></React.StrictMode>);
