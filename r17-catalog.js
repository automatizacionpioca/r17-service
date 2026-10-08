(function(){
  'use strict';

  const CATALOG_KEY='r17_catalog_v1';
  const HISTORY_KEY='r17_catalog_history_v1';
  const CFG_KEY='r17_cfg_v1';
  const DEFAULT_FACTURADO_PCT=12;
  const DEFAULT_IVA_PCT=21;
  const MAX_HISTORY_EVENTS=30;

  function n(v){
    const x=Number(String(v??'').replace(',','.'));
    return Number.isFinite(x)?x:0;
  }

  function normalizeText(value){
    return String(value??'')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'')
      .trim()
      .toLowerCase()
      .replace(/\s+/g,' ');
  }

  function readConfig(){
    try{return JSON.parse(localStorage.getItem(CFG_KEY)||'{}')}catch(e){return {}}
  }

  function invoicePercent(cfg){
    cfg=cfg||readConfig();
    const raw=cfg.facturadoPct;
    if(raw===undefined || String(raw).trim()==='') return DEFAULT_FACTURADO_PCT;
    return Math.max(0,n(raw));
  }

  function ivaPercent(cfg){
    cfg=cfg||readConfig();
    const raw=cfg.iva;
    if(raw===undefined || String(raw).trim()==='') return DEFAULT_IVA_PCT;
    return Math.max(0,n(raw));
  }

  function commercialPrices(cash,cfg){
    cash=Math.max(0,n(cash));
    const facturadoPct=invoicePercent(cfg);
    const iva=ivaPercent(cfg);
    const invoiceBase=cash*(1+facturadoPct/100);
    const ivaAmount=invoiceBase*(iva/100);
    return {cash,facturadoPct,invoiceBase,ivaPercent:iva,ivaAmount,invoiceTotal:invoiceBase+ivaAmount};
  }

  function normalizeItem(raw,index){
    raw=raw||{};
    const code=String(raw.code||raw.codigo||'').trim();
    const category=String(raw.category||raw.categoria||'').trim();
    const product=String(raw.product||raw.producto||'').trim();
    const description=String(raw.description||raw.descripcion||product||'').trim();
    const price=Math.max(0,n(
      raw.cashPrice!==undefined ? raw.cashPrice :
      raw.precioEfectivo!==undefined ? raw.precioEfectivo :
      raw.price!==undefined ? raw.price : 0
    ));
    const activeRaw=raw.active!==undefined?raw.active:raw.activo;
    const active=activeRaw===undefined
      ? true
      : !['no','false','0','inactivo'].includes(normalizeText(activeRaw));

    return {
      code:code || ('AUTO-'+String(index+1).padStart(4,'0')),
      category,
      product:product || description || ('Ítem '+(index+1)),
      description:description || product || ('Ítem '+(index+1)),
      cashPrice:price,
      active
    };
  }

  function load(){
    try{
      const raw=JSON.parse(localStorage.getItem(CATALOG_KEY)||'null');
      if(!raw || !Array.isArray(raw.items)) return {version:0,updatedAt:null,source:null,items:[]};
      return {
        version:Math.max(0,Number(raw.version)||0),
        updatedAt:raw.updatedAt||null,
        source:raw.source||null,
        items:raw.items.map(normalizeItem)
      };
    }catch(e){
      return {version:0,updatedAt:null,source:null,items:[]};
    }
  }

  function loadHistory(){
    try{
      const raw=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');
      return Array.isArray(raw)?raw:[];
    }catch(e){ return []; }
  }

  function saveHistory(events){
    localStorage.setItem(HISTORY_KEY,JSON.stringify((Array.isArray(events)?events:[]).slice(-MAX_HISTORY_EVENTS)));
  }

  function diffCatalog(oldItems,newItems){
    const oldMap=new Map((oldItems||[]).map(x=>[normalizeText(x.code),x]));
    const changes=[];
    (newItems||[]).forEach(item=>{
      const old=oldMap.get(normalizeText(item.code));
      if(!old){
        changes.push({code:item.code,product:item.product,oldPrice:null,newPrice:item.cashPrice,type:'nuevo'});
        return;
      }
      if(Number(old.cashPrice)!==Number(item.cashPrice)){
        changes.push({code:item.code,product:item.product,oldPrice:Number(old.cashPrice)||0,newPrice:Number(item.cashPrice)||0,type:'precio'});
      }
      oldMap.delete(normalizeText(item.code));
    });
    oldMap.forEach(old=>changes.push({code:old.code,product:old.product,oldPrice:Number(old.cashPrice)||0,newPrice:null,type:'eliminado'}));
    return changes;
  }

  function persist(items,meta){
    const previous=load();
    const normalized=(items||[]).map(normalizeItem);
    const seen=new Set();
    normalized.forEach(item=>{
      const key=normalizeText(item.code);
      if(!key) throw new Error('Todos los artículos deben tener Código.');
      if(seen.has(key)) throw new Error('Código duplicado: '+item.code);
      seen.add(key);
    });

    const record={
      version:previous.version+1,
      updatedAt:new Date().toISOString(),
      source:meta&&meta.source?String(meta.source):'app',
      items:normalized
    };
    localStorage.setItem(CATALOG_KEY,JSON.stringify(record));

    const changes=(meta&&Array.isArray(meta.changes)) ? meta.changes : diffCatalog(previous.items,normalized);
    const history=loadHistory();
    history.push({
      at:record.updatedAt,
      action:(meta&&meta.action)||'actualizacion',
      percent:meta&&meta.percent!==undefined?Number(meta.percent):null,
      fromVersion:previous.version,
      toVersion:record.version,
      changes
    });
    saveHistory(history);
    return record;
  }

  function activeCount(){ return load().items.filter(x=>x.active).length; }

  function categories(){
    return [...new Set(load().items.filter(x=>x.active).map(x=>x.category).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'es'));
  }

  function products(category){
    const c=normalizeText(category);
    return load().items
      .filter(x=>x.active && normalizeText(x.category)===c)
      .sort((a,b)=>a.product.localeCompare(b.product,'es'));
  }

  function findByCode(code){
    const key=normalizeText(code);
    return key ? (load().items.find(x=>normalizeText(x.code)===key)||null) : null;
  }

  function findMatch(value){
    const key=normalizeText(value);
    if(!key) return null;
    const active=load().items.filter(x=>x.active);
    return active.find(x=>normalizeText(x.code)===key)
      || active.find(x=>normalizeText(x.product)===key)
      || active.find(x=>normalizeText(x.description)===key)
      || null;
  }

  function headerMap(row){
    const map={};
    Object.keys(row||{}).forEach(k=>{map[normalizeText(k).replace(/[^a-z0-9]+/g,'')]=k;});
    return map;
  }

  function pick(row,map,aliases){
    for(const alias of aliases){
      const k=map[alias];
      if(k!==undefined && row[k]!==undefined) return row[k];
    }
    return '';
  }

  function rowsToItems(rows){
    if(!Array.isArray(rows) || !rows.length) throw new Error('El Excel no contiene artículos.');
    const map=headerMap(rows[0]);
    const items=rows.map((row,i)=>{
      const code=String(pick(row,map,['codigo','cod','id'])).trim();
      const category=String(pick(row,map,['categoria','rubro'])).trim();
      const product=String(pick(row,map,['producto','articulo','item','nombre'])).trim();
      const description=String(pick(row,map,['descripcion','descripcionpresupuesto','detalle'])).trim();
      const priceRaw=pick(row,map,['precioefectivo','efectivo','precio','preciobase']);
      const activeRaw=pick(row,map,['activo','habilitado','estado']);

      if(!code && !product && !description && String(priceRaw).trim()==='') return null;
      if(!code) throw new Error('Fila '+(i+2)+': falta Código.');
      if(!category) throw new Error('Fila '+(i+2)+': falta Categoría.');
      if(!product) throw new Error('Fila '+(i+2)+': falta Producto.');
      if(String(priceRaw).trim()==='' || !Number.isFinite(Number(String(priceRaw).replace(',','.')))){
        throw new Error('Fila '+(i+2)+': Precio efectivo inválido.');
      }

      return normalizeItem({
        code,category,product,description:description||product,
        cashPrice:Number(String(priceRaw).replace(',','.')),
        active:activeRaw===''?true:activeRaw
      },i);
    }).filter(Boolean);

    if(!items.length) throw new Error('El Excel no contiene artículos válidos.');
    return items;
  }

  async function importFile(file){
    if(!file) throw new Error('Seleccioná un archivo Excel.');
    if(!window.XLSX) throw new Error('No se pudo cargar el lector de Excel.');
    const data=await file.arrayBuffer();
    const wb=XLSX.read(data,{type:'array'});
    const preferred=wb.SheetNames.find(name=>normalizeText(name)==='catalogo') || wb.SheetNames[0];
    if(!preferred) throw new Error('El Excel no contiene hojas.');
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[preferred],{defval:''});
    return persist(rowsToItems(rows),{action:'importacion_excel',source:file.name});
  }

  function previewIncrease(percent){
    const pct=Number(String(percent??'').replace(',','.'));
    if(!Number.isFinite(pct)) throw new Error('Ingresá un porcentaje válido.');
    const current=load();
    return {
      percent:pct,
      items:current.items.map(x=>({...x,newCashPrice:Math.round((x.cashPrice*(1+pct/100))*100)/100}))
    };
  }

  function applyIncrease(percent){
    const preview=previewIncrease(percent);
    if(!preview.items.length) throw new Error('Primero importá un catálogo.');
    const pct=preview.percent;
    const current=load();
    const changes=[];
    const items=current.items.map(item=>{
      const next=Math.round((item.cashPrice*(1+pct/100))*100)/100;
      changes.push({code:item.code,product:item.product,oldPrice:item.cashPrice,newPrice:next,type:'aumento'});
      return {...item,cashPrice:next};
    });
    return persist(items,{action:'aumento_general',percent:pct,source:'configuracion',changes});
  }

  function workbookCurrent(){
    if(!window.XLSX) throw new Error('No se pudo cargar el generador de Excel.');
    const current=load();
    const rows=current.items.map(item=>({
      'Código':item.code,'Categoría':item.category,'Producto':item.product,
      'Descripción':item.description,'Precio efectivo':item.cashPrice,'Activo':item.active?'Sí':'No'
    }));
    const historyRows=[];
    loadHistory().forEach(ev=>{
      const changes=Array.isArray(ev.changes)&&ev.changes.length?ev.changes:[{}];
      changes.forEach(ch=>historyRows.push({
        'Fecha':ev.at||'','Versión anterior':ev.fromVersion??'','Versión nueva':ev.toVersion??'',
        'Acción':ev.action||'','Porcentaje':ev.percent??'','Código':ch.code||'',
        'Producto':ch.product||'','Precio anterior':ch.oldPrice??'','Precio nuevo':ch.newPrice??'',
        'Tipo de cambio':ch.type||''
      }));
    });
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows.length?rows:[{
      'Código':'','Categoría':'','Producto':'','Descripción':'','Precio efectivo':'','Activo':'Sí'
    }]),'CATALOGO');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(historyRows.length?historyRows:[{
      'Fecha':'','Versión anterior':'','Versión nueva':'','Acción':'','Porcentaje':'',
      'Código':'','Producto':'','Precio anterior':'','Precio nuevo':'','Tipo de cambio':''
    }]),'HISTORIAL_CAMBIOS');
    return wb;
  }

  function workbookTemplate(){
    if(!window.XLSX) throw new Error('No se pudo cargar el generador de Excel.');
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([
      {'Código':'ELE001','Categoría':'Electrónica','Producto':'Central electrónica','Descripción':'Recambio de central electrónica','Precio efectivo':'','Activo':'Sí'},
      {'Código':'CON001','Categoría':'Controles remotos','Producto':'Control remoto','Descripción':'Control remoto para automatización','Precio efectivo':'','Activo':'Sí'},
      {'Código':'SEN001','Categoría':'Sensores','Producto':'Sensores infrarrojos','Descripción':'Recambio de sensores infrarrojos','Precio efectivo':'','Activo':'Sí'},
      {'Código':'CAP001','Categoría':'Capacitores','Producto':'Capacitor','Descripción':'Recambio de capacitor de arranque','Precio efectivo':'','Activo':'Sí'},
      {'Código':'FIN001','Categoría':'Finales de carrera','Producto':'Sensor de final de carrera','Descripción':'Recambio de sensor de final de carrera','Precio efectivo':'','Activo':'Sí'}
    ]),'CATALOGO');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
      ['CATÁLOGO piOca®'],
      ['El único precio editable es Precio efectivo.'],
      ['Facturado e IVA se calculan automáticamente desde Configuración.'],
      ['Código debe ser único y estable para actualizar presupuestos históricos.'],
      ['Activo: Sí / No.']
    ]),'LEEME');
    return wb;
  }

  function saveWorkbook(wb,fileName){
    if(window.AndroidCotizador && typeof AndroidCotizador.saveFile==='function'){
      const b64=XLSX.write(wb,{bookType:'xlsx',type:'base64'});
      AndroidCotizador.saveFile(
        'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,'+b64,
        fileName,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      return true;
    }
    XLSX.writeFile(wb,fileName);
    return true;
  }

  function downloadCurrent(){
    const current=load();
    const stamp=new Date().toISOString().slice(0,10);
    return saveWorkbook(workbookCurrent(),'Catalogo_piOca_v'+current.version+'_'+stamp+'.xlsx');
  }

  function downloadTemplate(){
    return saveWorkbook(workbookTemplate(),'Catalogo_piOca_PLANTILLA.xlsx');
  }

  window.PiocaCatalog={
    CATALOG_KEY,HISTORY_KEY,CFG_KEY,load,loadHistory,activeCount,categories,products,
    findByCode,findMatch,importFile,previewIncrease,applyIncrease,commercialPrices,
    invoicePercent,ivaPercent,downloadCurrent,downloadTemplate,normalizeText,persist
  };
})();
