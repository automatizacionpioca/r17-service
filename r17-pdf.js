(function(){
  const BLUE=[28,88,164];
  const DARK=[37,53,72];
  const GREY=[111,126,145];
  const LIGHT=[247,249,252];
  const BORDER=[217,226,236];

  function n(v){
    const x=Number(v);
    return Number.isFinite(x)?x:0;
  }

  function money(v){
    return new Intl.NumberFormat('es-AR',{
      style:'currency',
      currency:'ARS',
      maximumFractionDigits:0
    }).format(n(v));
  }

  function minutesText(value){
    const min=Math.max(0,Math.round(n(value)));
    const h=Math.floor(min/60);
    const m=min%60;
    if(h && m) return h+' h '+m+' min';
    if(h) return h+' h';
    return m+' min';
  }

  function dateText(iso){
    const d=iso ? new Date(iso) : new Date();
    return new Intl.DateTimeFormat('es-AR',{
      day:'2-digit',
      month:'2-digit',
      year:'numeric'
    }).format(d);
  }

  function sanitizeFilePart(value){
    return String(value||'servicio')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-zA-Z0-9]+/g,'_')
      .replace(/^_+|_+$/g,'')
      .slice(0,42) || 'servicio';
  }

  function itemsOf(record){
    if(Array.isArray(record.items)) return record.items;
    const snap=record.snapshot||{};
    return Array.isArray(snap.items)?snap.items:[];
  }

  function normalize(record){
    const snap=record.snapshot||{};
    const prices=snap.prices||{};
    const items=itemsOf(record);

    const oneWayKm=
      record.one_way_km!==undefined
        ? n(record.one_way_km)
        : n(snap.one_way_km);

    const laborMinutes=
      record.labor_minutes!==undefined
        ? n(record.labor_minutes)
        : n(snap.labor_minutes);

    const roundTripMinutes=
      record.round_trip_minutes!==undefined
        ? n(record.round_trip_minutes)
        : n(snap.round_trip_minutes);

    const employedMinutes=
      snap.total_employed_minutes!==undefined
        ? n(snap.total_employed_minutes)
        : laborMinutes+roundTripMinutes;

    const itemTotal=items.reduce((sum,item)=>{
      return sum+n(item.qty)*n(item.price);
    },0);

    const cash=
      record.total_cash_rounded!==undefined
        ? n(record.total_cash_rounded)
        : n(prices.total_cash_rounded);

    const visitRounded=
      prices.visit_labor_rounded!==undefined
        ? n(prices.visit_labor_rounded)
        : Math.max(0,cash-itemTotal);

    const ivaPercent=
      record.iva_percent!==undefined
        ? n(record.iva_percent)
        : (prices.iva_percent!==undefined?n(prices.iva_percent):21);

    const invoice=
      record.total_invoice!==undefined
        ? n(record.total_invoice)
        : (prices.total_invoice!==undefined
            ? n(prices.total_invoice)
            : cash*(1+ivaPercent/100));

    const address=
      record.customer_address ||
      snap.customer_address ||
      'Ubicación registrada';

    return {
      id:record.id||'',
      createdAt:record.created_at||new Date().toISOString(),
      address,
      oneWayKm,
      employedMinutes,
      items,
      visitRounded,
      cash,
      ivaPercent,
      invoice
    };
  }

  async function logoDataUrl(){
    try{
      const response=await fetch(
        'https://automatizacionpioca.github.io/pioca-gps/logo-pioca.png',
        {cache:'force-cache'}
      );
      if(!response.ok) throw new Error('logo');
      const blob=await response.blob();
      return await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result);
        reader.onerror=reject;
        reader.readAsDataURL(blob);
      });
    }catch(e){
      return null;
    }
  }

  function fileName(record){
    const r=normalize(record);
    return 'Resumen_'+sanitizeFilePart(r.address)+'.pdf';
  }

  async function build(record){
    if(!window.jspdf || !window.jspdf.jsPDF){
      throw new Error('No se pudo cargar el generador de PDF.');
    }

    const {jsPDF}=window.jspdf;
    const doc=new jsPDF({
      orientation:'portrait',
      unit:'mm',
      format:'a4',
      compress:true
    });

    const r=normalize(record);
    const margin=18;
    const pageW=210;
    const pageH=297;
    const contentW=pageW-margin*2;
    let y=18;

    function setText(rgb){
      doc.setTextColor(rgb[0],rgb[1],rgb[2]);
    }

    function ensureSpace(h){
      if(y+h>pageH-18){
        doc.addPage();
        y=18;
      }
    }

    function divider(){
      doc.setDrawColor(BORDER[0],BORDER[1],BORDER[2]);
      doc.setLineWidth(.35);
      doc.line(margin,y,pageW-margin,y);
    }

    function infoRow(label,value,opts={}){
      ensureSpace(opts.height||14);
      const labelW=64;
      doc.setFont('helvetica','normal');
      doc.setFontSize(10.5);
      setText(GREY);
      doc.text(label,margin,y);

      doc.setFont('helvetica','bold');
      doc.setFontSize(opts.valueSize||10.5);
      setText(opts.blue?BLUE:DARK);

      const lines=doc.splitTextToSize(String(value),contentW-labelW-3);
      doc.text(lines,margin+labelW,y,{align:'left'});
      const used=Math.max(7,lines.length*5);
      y+=used+4;
      divider();
      y+=5;
    }

    const logo=await logoDataUrl();

    if(logo){
      try{
        doc.addImage(logo,'PNG',margin,y,28,28,undefined,'FAST');
      }catch(e){}
    }else{
      doc.setFont('helvetica','bold');
      doc.setFontSize(23);
      setText(BLUE);
      doc.text('piOca®',margin,y+16);
    }

    doc.setFont('helvetica','bold');
    doc.setFontSize(19);
    setText(DARK);
    doc.text('Resumen de servicio',margin+36,y+11);

    doc.setFont('helvetica','normal');
    doc.setFontSize(9.5);
    setText(GREY);
    doc.text('piOca® | abre y cierra siempre',margin+36,y+18);

    doc.setFont('helvetica','normal');
    doc.setFontSize(9);
    doc.text('Fecha: '+dateText(r.createdAt),pageW-margin,y+26,{align:'right'});

    y+=38;

    doc.setFillColor(LIGHT[0],LIGHT[1],LIGHT[2]);
    doc.setDrawColor(BORDER[0],BORDER[1],BORDER[2]);
    doc.roundedRect(margin,y,contentW,49,4,4,'FD');

    y+=10;
    doc.setFont('helvetica','normal');
    doc.setFontSize(10);
    setText(GREY);
    doc.text('Ubicación',margin+7,y);

    doc.setFont('helvetica','bold');
    doc.setFontSize(11);
    setText(DARK);
    const addressLines=doc.splitTextToSize(r.address,contentW-60);
    doc.text(addressLines,margin+55,y);

    y+=Math.max(13,addressLines.length*5+5);

    doc.setFont('helvetica','normal');
    doc.setFontSize(10);
    setText(GREY);
    doc.text('Distancia recorrida',margin+7,y);
    doc.setFont('helvetica','bold');
    setText(DARK);
    doc.text(r.oneWayKm.toFixed(1)+' km',pageW-margin-7,y,{align:'right'});

    y+=11;

    doc.setFont('helvetica','normal');
    setText(GREY);
    doc.text('Tiempo empleado en el servicio',margin+7,y);
    doc.setFont('helvetica','bold');
    setText(DARK);
    doc.text(minutesText(r.employedMinutes),pageW-margin-7,y,{align:'right'});

    y+=19;

    doc.setFont('helvetica','bold');
    doc.setFontSize(13);
    setText(BLUE);
    doc.text('Detalle',margin,y);
    y+=9;

    infoRow(
      'Costo de visita y mano de obra',
      money(r.visitRounded),
      {blue:true,height:17}
    );

    if(r.items.length){
      ensureSpace(12+r.items.length*13);
      doc.setFont('helvetica','bold');
      doc.setFontSize(10.5);
      setText(DARK);
      doc.text('Accesorios / repuestos',margin,y);
      y+=7;

      r.items.forEach(item=>{
        const qty=Math.max(1,n(item.qty));
        const desc=String(item.desc||'Ítem');
        const total=qty*n(item.price);

        doc.setFont('helvetica','normal');
        doc.setFontSize(10);
        setText(GREY);
        const detail=(qty!==1?qty+' × ':'')+desc;
        const detailLines=doc.splitTextToSize(detail,105);
        doc.text(detailLines,margin,y);

        doc.setFont('helvetica','bold');
        setText(DARK);
        doc.text(money(total),pageW-margin,y,{align:'right'});

        y+=Math.max(8,detailLines.length*5+3);
        divider();
        y+=4;
      });

      y+=3;
    }

    ensureSpace(62);

    doc.setFillColor(LIGHT[0],LIGHT[1],LIGHT[2]);
    doc.setDrawColor(BORDER[0],BORDER[1],BORDER[2]);
    doc.roundedRect(margin,y,contentW,17,4,4,'FD');

    doc.setFont('helvetica','normal');
    doc.setFontSize(11);
    setText(GREY);
    doc.text('Precio efectivo',margin+7,y+10.5);

    doc.setFont('helvetica','bold');
    doc.setFontSize(15);
    setText(BLUE);
    doc.text(money(r.cash),pageW-margin-7,y+10.8,{align:'right'});

    y+=23;

    doc.setFillColor(255,255,255);
    doc.setDrawColor(193,208,226);
    doc.setLineWidth(.45);
    doc.roundedRect(margin,y,contentW,35,4,4,'FD');

    doc.setFont('helvetica','normal');
    doc.setFontSize(10.5);
    setText(GREY);
    doc.text('Precio por transferencia + IVA',margin+7,y+11);

    doc.setFont('helvetica','bold');
    doc.setFontSize(11.5);
    setText(DARK);
    doc.text(money(r.cash)+' + IVA',pageW-margin-7,y+11,{align:'right'});

    doc.setDrawColor(BORDER[0],BORDER[1],BORDER[2]);
    doc.line(margin+7,y+17,pageW-margin-7,y+17);

    doc.setFont('helvetica','normal');
    doc.setFontSize(10.5);
    setText(GREY);
    doc.text('Precio final IVA incluido',margin+7,y+27);

    doc.setFont('helvetica','bold');
    doc.setFontSize(14);
    setText(BLUE);
    doc.text(money(r.invoice),pageW-margin-7,y+27,{align:'right'});

    doc.setFont('helvetica','normal');
    doc.setFontSize(8.5);
    setText(GREY);
    doc.text(
      'Resumen emitido por piOca®',
      pageW/2,
      pageH-10,
      {align:'center'}
    );

    return doc.output('blob');
  }

  async function openPdf(record){
    const w=window.open('','_blank');
    try{
      const blob=await build(record);
      const url=URL.createObjectURL(blob);
      if(w){
        w.location.href=url;
      }else{
        window.location.href=url;
      }
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch(e){
      if(w) w.close();
      throw e;
    }
  }

  async function sharePdf(record){
    const blob=await build(record);
    const name=fileName(record);
    const file=new File([blob],name,{type:'application/pdf'});

    if(
      navigator.share &&
      (!navigator.canShare || navigator.canShare({files:[file]}))
    ){
      await navigator.share({
        title:'Resumen de servicio piOca®',
        text:'Hola, adjuntamos el resumen del servicio realizado por piOca®.',
        files:[file]
      });
      return true;
    }

    await openPdf(record);
    return false;
  }

  window.PiocaPDF={
    build,
    openPdf,
    sharePdf,
    fileName,
    normalize
  };
})();