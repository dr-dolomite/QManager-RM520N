import CustomDnsCard from "@/components/local-network/custom-dns/custom-dns-card";

const CustomDnsPage = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Custom DNS</h1>
        <p className="text-muted-foreground">
          Choose which DNS resolver the modem uses to answer LAN clients&apos;
          queries.
        </p>
      </div>
      <CustomDnsCard />
    </div>
  );
};

export default CustomDnsPage;
