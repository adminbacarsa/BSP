export const POPUP_STYLES = `
    /* ANIMACIONES */
    @keyframes pulse-ring { 0% { transform: scale(0.33); opacity: 1; } 80%, 100% { transform: scale(2.5); opacity: 0; } }
    @keyframes pulse-dot { 0% { transform: scale(0.8); } 50% { transform: scale(1); } 100% { transform: scale(0.8); } }
    
    .marker-alert-container { position: relative; width: 30px; height: 30px; }
    .marker-alert-ring { position: absolute; height: 30px; width: 30px; border-radius: 50%; background-color: rgba(225, 29, 72, 0.6); animation: pulse-ring 1.5s cubic-bezier(0.215, 0.61, 0.355, 1) infinite; }
    .marker-alert-dot { position: absolute; left: 0; top: 0; height: 30px; width: 30px; background-color: #e11d48; border: 2px solid white; border-radius: 50%; color: white; font-weight: 900; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); animation: pulse-dot 1.5s cubic-bezier(0.455, 0.03, 0.515, 0.955) -0.4s infinite; }

    /* TOOLTIPS DARK GLASS */
    .leaflet-tooltip { background: transparent !important; border: none !important; box-shadow: none !important; }
    .leaflet-tooltip.custom-tooltip {
        background-color: #0f172a !important;
        border: 1px solid rgba(255,255,255,0.2) !important;
        color: #f8fafc !important;
        font-family: ui-sans-serif, system-ui, sans-serif !important;
        font-weight: 800 !important;
        font-size: 11px !important;
        text-transform: uppercase !important;
        border-radius: 6px !important;
        padding: 5px 10px !important;
        box-shadow: 0 4px 15px rgba(0,0,0,0.5) !important;
        white-space: nowrap !important;
    }
    .leaflet-tooltip-top:before { border-top-color: #0f172a !important; }

    /* TARJETAS POPUP PRO */
    .leaflet-popup-content-wrapper { padding: 0 !important; border-radius: 12px !important; overflow: visible !important; background: white !important; max-height: none !important; }
    .leaflet-popup-content { margin: 0 !important; width: 560px !important; font-family: ui-sans-serif, system-ui, sans-serif !important; overflow: visible !important; }
    
    .pop-header { padding: 16px; color: white; position: relative; display: flex; justify-content: space-between; align-items: flex-start; }
    .pop-header.normal { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); }
    .pop-header.alert { background: linear-gradient(135deg, #be123c 0%, #881337 100%); }
    
    .pop-info { display: flex; align-items: center; gap: 10px; }
    .pop-badges { display: flex; gap: 5px; position: absolute; bottom: 12px; right: 12px; }
    
    .pop-badge { 
        background: rgba(255,255,255,0.9); color: #334155; 
        font-size: 9px; font-weight: 800; padding: 3px 8px; 
        border-radius: 12px; display: flex; align-items: center; gap: 3px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .pop-badge.alert { color: #e11d48; background: #fff; }

    .pop-body { padding: 16px; max-height: 250px; overflow-y: auto; background: #fff; }
    
    .pop-address { 
        font-size: 10px; color: #64748b; margin-bottom: 12px; 
        display: flex; align-items: center; gap: 4px; background: #f8fafc;
        padding: 8px; border-radius: 6px; border: 1px solid #e2e8f0;
    }

    .pop-row { 
        background: #fff; border: 1px solid #e2e8f0; border-left-width: 4px; 
        border-radius: 8px; padding: 10px; margin-bottom: 8px; 
        box-shadow: 0 1px 2px rgba(0,0,0,0.02); transition: all 0.2s;
    }
    .pop-row:hover { transform: translateY(-1px); box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    .pop-row.present { border-left-color: #10b981; }
    .pop-row.absent { border-left-color: #94a3b8; opacity: 0.6; background: #f8fafc; }
    .pop-row.late { border-left-color: #e11d48; background: #fff1f2; }
    .pop-row.expired { border-left-color: #64748b; background: #f1f5f9; opacity: 0.8; }
    .pop-row.overdue { border-left-color: #ef4444; background: #fef2f2; animation: pulse-soft 2s infinite; }

    .pop-row-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .pop-name { font-weight: 700; font-size: 12px; color: #334155; display: flex; align-items: center; gap: 5px; }
    
    .pop-tag { font-size: 8px; padding: 2px 5px; border-radius: 4px; font-weight: bold; color: white; text-transform: uppercase; }
    .pop-tag.late { background: #e11d48; }
    .pop-tag.on { background: #10b981; }
    .pop-tag.exp { background: #64748b; }
    .pop-tag.over { background: #ef4444; }

    .pop-time { font-size: 10px; color: #64748b; display: flex; align-items: center; gap: 4px; background: #f1f5f9; padding: 3px 6px; border-radius: 4px; width: fit-content; margin-bottom: 10px; }

    .pop-actions { display: flex; gap: 6px; }
    .pop-btn { 
        border: none; border-radius: 6px; padding: 8px 10px; 
        font-size: 10px; font-weight: 700; cursor: pointer; 
        text-transform: uppercase; color: white; flex: 1; transition: opacity 0.2s;
    }
    .pop-btn:hover { opacity: 0.9; }
    .btn-checkin { background: #4f46e5; }
    .btn-checkout { background: #7e22ce; }
    .btn-alert { background: #e11d48; }
    .btn-nov { background: #fff; color: #475569; border: 1px solid #cbd5e1; flex: 0 0 auto; }
    .btn-nov:hover { background: #f1f5f9; }

    @keyframes pulse-soft { 0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); } 70% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); } 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } }
`;